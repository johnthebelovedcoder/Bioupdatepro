import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { AuditService } from '../audit/audit.service';
import { OperationsPostingService } from './operations-posting.service';
import { BiologicalAssetService } from '../biological-assets/biological-asset.service';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * Where the work recorded on a phone actually lands.
 *
 * The web app has recorded rounds, treatments, harvests, stage changes and
 * placements for some time; every one of them queued in the browser's outbox
 * and had nowhere to go. This is the other end of that queue.
 *
 * Three properties hold for every method here, and they are the reason this is
 * a service rather than five controller bodies:
 *
 *   1. ONE TRANSACTION per submission. A round that records feed, production
 *      and twelve deaths must not be able to half-land — the population
 *      decrement and the mortality row that justifies it commit together or
 *      neither does. `population` is a materialised balance, and the only thing
 *      that makes it trustworthy is that nothing moves it outside the
 *      transaction of the event that caused the move.
 *
 *   2. IDEMPOTENT. The outbox generates its key once and reuses it across every
 *      retry, so the same round arriving twice is one round. This is not a
 *      nicety: the client retries on a timeout, and a timeout is exactly the
 *      case where the server may already have committed.
 *
 *   3. SCOPED AND ATTRIBUTED. The company comes from the signed-in user and
 *      never from the payload, and every write leaves an audit record naming
 *      who did it (Rule 9).
 */
@Injectable()
export class OperationsService {
  private readonly logger = new Logger(OperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly postings: OperationsPostingService,
    private readonly biologicalAssets: BiologicalAssetService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Placement — a new population arrives                                */
  /* ------------------------------------------------------------------ */

  async placeGroup(input: {
    companyId: string;
    actor: WorkflowActor;
    idempotencyKey: string;
    payload: {
      module: string;
      code: string;
      breed: string;
      purpose: string;
      stage: string;
      house: string;
      openingPopulation: number;
      startedOn: string;
      source?: string | null;
      acquisitionCostKobo?: string | null;
    };
  }) {
    const { companyId, actor, idempotencyKey, payload } = input;

    if (!payload.code?.trim()) throw new BadRequestException('A code is required.');
    if (!(payload.openingPopulation > 0)) {
      throw new BadRequestException('Opening population must be greater than zero.');
    }
    if (!payload.stage?.trim()) throw new BadRequestException('A starting stage is required.');

    return this.prisma.$transaction(async (tx) => {
      const scope = 'operations.placement';
      const reserved = await this.idempotency.reserve(scope, idempotencyKey, payload, tx);
      if (reserved.replayed) return { id: reserved.resultRef!, replayed: true };

      const penHouse = await this.resolvePenHouse(tx, companyId, payload.house);

      const group = await tx.livestockGroup.create({
        data: {
          companyId,
          branchId: penHouse.farm.branchId,
          farmId: penHouse.farmId,
          penHouseId: penHouse.id,
          code: payload.code.trim(),
          speciesKey: payload.module,
          breed: payload.breed,
          purpose: payload.purpose,
          // A population starts at the first stage its module declares. The web
          // app owns that list, so it is sent rather than guessed here — the
          // API has no opinion about what a snail's stages are (same rule that
          // governs `stageBreakdown`), so it cannot derive this from `purpose`.
          stage: payload.stage,
          openingPopulation: payload.openingPopulation,
          population: payload.openingPopulation,
          startedOn: asDate(payload.startedOn),
          source: payload.source ?? null,
          acquisitionCostKobo: payload.acquisitionCostKobo
            ? BigInt(payload.acquisitionCostKobo)
            : 0n,
        },
      });

      await this.idempotency.commit(scope, idempotencyKey, payload, group.id, tx);
      await this.audit.write(
        {
          transactionId: group.id,
          module: 'OPERATIONS',
          entityType: 'LivestockGroup',
          entityId: group.id,
          status: 'ACTIVE',
          action: AuditAction.CREATE,
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          device: actor.device,
          comments: `Placed ${payload.openingPopulation} at ${payload.house}`,
        },
        tx,
      );

      return { id: group.id, replayed: false };
    }).then(async (result) => {
      /*
       * Dr biological asset / Cr GRNI — after commit, never inside it. See
       * the note on postFeedIssues: the placement is the worker's record of
       * what arrived, and it must survive whatever the ledger thinks.
       */
      if (!result.replayed) {
        const outcome = await this.biologicalAssets.postAcquisition({
          groupId: result.id,
          actor,
        });
        if (!outcome.posted && outcome.reason && outcome.reason !== 'No acquisition cost recorded.') {
          this.logger.warn(`Placement ${result.id}: ${outcome.reason}`);
        }
      }
      return result;
    });
  }

  /* ------------------------------------------------------------------ */
  /* The daily round                                                     */
  /* ------------------------------------------------------------------ */

  async recordRound(input: {
    companyId: string;
    actor: WorkflowActor;
    idempotencyKey: string;
    payload: {
      module: string;
      date: string;
      entries: Array<{
        groupCode: string;
        feedType?: string;
        feedKg?: number;
        production?: Record<string, number>;
        deaths?: number;
        causes?: string[];
        carriedOver?: boolean;
        notes?: string | null;
        photo?: { name: string; dataUrl: string; bytes: number } | null;
      }>;
    };
  }) {
    const { companyId, actor, idempotencyKey, payload } = input;

    const result = await this.prisma.$transaction(
      async (tx) => {
        const scope = 'operations.round';
        const reserved = await this.idempotency.reserve(scope, idempotencyKey, payload, tx);
        if (reserved.replayed) {
          return { ids: JSON.parse(reserved.resultRef!) as string[], replayed: true };
        }

        const ids: string[] = [];

        for (const entry of payload.entries) {
          const group = await this.resolveGroup(tx, companyId, entry.groupCode);

          const deaths = Math.max(0, Math.trunc(entry.deaths ?? 0));
          if (deaths > group.population) {
            throw new BadRequestException(
              `${group.code} has ${group.population} left — cannot record ${deaths} lost.`,
            );
          }

          const production = Object.entries(entry.production ?? {})
            .filter(([, quantity]) => Number.isFinite(quantity))
            .map(([fieldKey, quantity]) => ({
              fieldKey,
              quantity: new Prisma.Decimal(quantity),
            }));

          /*
           * One row per population per day, enforced by the database.
           *
           * Hitting it is not a server fault, so it must not surface as a 500 —
           * and it must not surface as a 409 either, because the outbox treats
           * 409 as "an earlier attempt landed" and would mark the round sent
           * when nothing was saved. 422 is the honest answer: the submission
           * was understood and refused, permanently, and the worker is told
           * exactly which population and which day.
           */
          const existing = await tx.dailyRecord.findUnique({
            where: {
              groupId_recordedOn: { groupId: group.id, recordedOn: asDate(payload.date) },
            },
            select: { id: true },
          });
          if (existing) {
            throw new UnprocessableEntityException(
              `${group.code} already has a round recorded for ${payload.date}. Changing a day that has been recorded is a correction, and corrections are not built yet.`,
            );
          }

          const record = await tx.dailyRecord.create({
            data: {
              companyId,
              groupId: group.id,
              recordedOn: asDate(payload.date),
              carriedOver: entry.carriedOver ?? false,
              notes: entry.notes ?? null,
              recordedById: actor.userId,
              ...(production.length > 0 ? { production: { create: production } } : {}),
              ...(entry.feedKg && entry.feedKg > 0
                ? {
                    feedIssues: {
                      create: [
                        {
                          feedName: entry.feedType ?? 'Feed',
                          quantityKg: new Prisma.Decimal(entry.feedKg),
                          /*
                           * Priced here, at the moment of issue.
                           *
                           * The worker enters kilograms; nobody standing in a
                           * pen knows what a kilo of layer mash costs, and they
                           * should not have to. Without this the feed issue
                           * carried a quantity and no value, so the batch's
                           * work-in-progress stayed empty and the largest cost
                           * on the farm never reached the ledger at all.
                           */
                          ...(await this.priceFeed(
                            tx,
                            companyId,
                            entry.feedType ?? 'Feed',
                            entry.feedKg,
                            asDate(payload.date),
                          )),
                        },
                      ],
                    },
                  }
                : {}),
              ...(deaths > 0
                ? {
                    mortality: {
                      create: [
                        {
                          quantity: deaths,
                          causes: entry.causes ?? [],
                          notes: entry.notes ?? null,
                          ...(entry.photo
                            ? {
                                photos: {
                                  create: [
                                    {
                                      fileName: entry.photo.name,
                                      mimeType: mimeFromDataUrl(entry.photo.dataUrl),
                                      byteSize: entry.photo.bytes,
                                      data: entry.photo.dataUrl,
                                    },
                                  ],
                                },
                              }
                            : {}),
                        },
                      ],
                    },
                  }
                : {}),
            },
          });

          // The decrement rides in this transaction with the row that justifies
          // it. See the note at the top of this file.
          if (deaths > 0) {
            await tx.livestockGroup.update({
              where: { id: group.id },
              data: { population: { decrement: deaths } },
            });
          }

          ids.push(record.id);

          await this.audit.write(
            {
              transactionId: record.id,
              module: 'OPERATIONS',
              entityType: 'DailyRecord',
              entityId: record.id,
              status: 'RECORDED',
              action: AuditAction.CREATE,
              userId: actor.userId,
              ipAddress: actor.ipAddress,
              device: actor.device,
              comments: `${group.code} on ${payload.date}`,
              metadata: { deaths, feedKg: entry.feedKg ?? 0 },
            },
            tx,
          );
        }

        await this.idempotency.commit(scope, idempotencyKey, payload, JSON.stringify(ids), tx);
        return { ids, replayed: false };
      },
      // A round can carry a dozen stops with photographs; the default 5s is not
      // enough on a cold connection pool.
      { timeout: 20_000 },
    );

    /*
     * Post the feed AFTER the round has committed, never inside it.
     *
     * The round is the worker's record of what they saw and it must survive
     * whatever the ledger thinks. If the period is closed, or no cost centre is
     * configured, the posting fails and the round still stands with a null
     * journal — visibly unposted rather than lost. A worker who walked four
     * houses in the rain should not have that thrown away because of an
     * accounting setting they have never heard of.
     */
    if (!result.replayed) {
      for (const id of result.ids) {
        const outcome = await this.postings.postFeedIssues({
          companyId,
          dailyRecordId: id,
          actor,
        });
        if (outcome.skipped.length > 0) {
          this.logger.warn(`Round ${id}: ${outcome.skipped.join('; ')}`);
        }

        // Dr fair-value/abnormal loss / Cr biological asset — same after-commit
        // convention. A round with no deaths finds nothing here and costs one
        // empty query.
        const deaths = await this.prisma.mortalityRecord.findMany({
          where: { dailyRecordId: id, journalEntryId: null },
          select: { id: true },
        });
        for (const death of deaths) {
          const outcome = await this.biologicalAssets.postMortality({
            mortalityRecordId: death.id,
            actor,
          });
          if (!outcome.posted && outcome.reason) {
            this.logger.warn(`Mortality ${death.id}: ${outcome.reason}`);
          }
        }
      }
    }

    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Treatments                                                          */
  /* ------------------------------------------------------------------ */

  async recordTreatment(input: {
    companyId: string;
    actor: WorkflowActor;
    idempotencyKey: string;
    payload: {
      groupCode: string;
      eventId?: string | null;
      name: string;
      date: string;
      givenBy: string;
      route: string;
      treated: number;
      populationAtTime?: number;
      productBatch?: string | null;
      withdrawalDays?: number;
      safeToSellFrom?: string | null;
      costKobo?: string;
      notes?: string | null;
    };
  }) {
    const { companyId, actor, idempotencyKey, payload } = input;

    const result = await this.prisma.$transaction(async (tx) => {
      const scope = 'operations.treatment';
      const reserved = await this.idempotency.reserve(scope, idempotencyKey, payload, tx);
      if (reserved.replayed) return { id: reserved.resultRef!, replayed: true };

      const group = await this.resolveGroup(tx, companyId, payload.groupCode);

      if (payload.treated > group.population) {
        throw new BadRequestException(
          `${group.code} has ${group.population} — cannot treat ${payload.treated}.`,
        );
      }

      const record = await tx.treatmentRecord.create({
        data: {
          companyId,
          groupId: group.id,
          healthEventId: payload.eventId ?? null,
          name: payload.name,
          givenOn: asDate(payload.date),
          route: payload.route,
          givenBy: payload.givenBy,
          treatedCount: payload.treated,
          populationAtTime: payload.populationAtTime ?? group.population,
          productBatch: payload.productBatch ?? null,
          withdrawalDays: payload.withdrawalDays ?? 0,
          safeToSellFrom: payload.safeToSellFrom ? asDate(payload.safeToSellFrom) : null,
          costKobo: payload.costKobo ? BigInt(payload.costKobo) : 0n,
          notes: payload.notes ?? null,
          recordedById: actor.userId,
        },
      });

      // Only close the schedule when this treatment answers one. An unscheduled
      // treatment is not evidence that anything on the programme was done.
      if (payload.eventId) {
        await tx.healthEvent.updateMany({
          where: { id: payload.eventId, companyId },
          data: { status: 'DONE' },
        });
      }

      await this.idempotency.commit(scope, idempotencyKey, payload, record.id, tx);
      await this.audit.write(
        {
          transactionId: record.id,
          module: 'OPERATIONS',
          entityType: 'TreatmentRecord',
          entityId: record.id,
          status: 'RECORDED',
          action: AuditAction.CREATE,
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          device: actor.device,
          comments: `${payload.name} · ${group.code}`,
          metadata: {
            treated: payload.treated,
            withdrawalDays: payload.withdrawalDays ?? 0,
          },
        },
        tx,
      );

      return { id: record.id, replayed: false };
    });

    // Same reasoning as the round: the treatment is a clinical record first and
    // an accounting entry second, so it is never rolled back for the ledger.
    if (!result.replayed) {
      const outcome = await this.postings.postTreatment({
        companyId,
        treatmentId: result.id,
        actor,
      });
      if (outcome.reason) {
        this.logger.warn(`Treatment ${result.id} did not post: ${outcome.reason}`);
      }
    }

    return result;
  }

  /**
   * What a feed issue is worth, from the item master's standard cost.
   *
   * Standard cost rather than a price somebody typed: the worker issuing feed
   * is not pricing it, and a farm that changes feed supplier mid-batch should
   * not see its cost-per-bird jump because of who happened to deliver. The
   * difference between standard and what was actually paid is a purchase price
   * variance, and it belongs in procurement, not in a pen at 6am.
   *
   * Returns nothing when the feed is not an item or has no cost effective on
   * that date. That is not a failure — a farm can issue feed it bought off a
   * truck and never entered — and the issue is still recorded, just unpriced
   * and therefore unposted, which is visible rather than silently zero.
   */
  private async priceFeed(
    tx: Prisma.TransactionClient,
    companyId: string,
    feedName: string,
    quantityKg: number,
    on: Date,
  ): Promise<{ itemId?: string; unitCostKobo?: bigint; valueKobo?: bigint }> {
    const item = await tx.item.findFirst({
      where: {
        companyId,
        active: true,
        OR: [{ description: feedName }, { code: feedName }],
      },
      select: { id: true },
    });
    if (!item) return {};

    const cost = await tx.itemStandardCost.findFirst({
      where: {
        itemId: item.id,
        effectiveFrom: { lte: on },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
      },
      orderBy: { effectiveFrom: 'desc' },
      select: { standardCostKobo: true },
    });
    if (!cost) return { itemId: item.id };

    /*
     * Rounded to whole kobo, because money is an integer here and 0.5 kg of
     * feed at an odd price is not. Rounding at the line, once, rather than
     * letting a fraction ride into the journal where it would not balance.
     */
    const value = BigInt(Math.round(quantityKg * Number(cost.standardCostKobo)));

    return {
      itemId: item.id,
      unitCostKobo: cost.standardCostKobo,
      valueKobo: value,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Harvests                                                            */
  /* ------------------------------------------------------------------ */

  async recordHarvest(input: {
    companyId: string;
    actor: WorkflowActor;
    idempotencyKey: string;
    payload: {
      groupCode: string;
      date: string;
      grade: string;
      kg: number;
      count: number;
      populationAtTime?: number;
      destination: string;
      movedToGroup?: string | null;
      notes?: string | null;
    };
  }) {
    const { companyId, actor, idempotencyKey, payload } = input;

    return this.prisma.$transaction(async (tx) => {
      const scope = 'operations.harvest';
      const reserved = await this.idempotency.reserve(scope, idempotencyKey, payload, tx);
      if (reserved.replayed) return { id: reserved.resultRef!, replayed: true };

      const group = await this.resolveGroup(tx, companyId, payload.groupCode);

      if (payload.count > group.population) {
        throw new BadRequestException(
          `${group.code} has ${group.population} — cannot harvest ${payload.count}.`,
        );
      }

      await this.biologicalAssets.assertStageAgeEligible({
        companyId,
        speciesKey: group.speciesKey,
        breed: group.breed,
        stageName: group.stage,
        startedOn: group.startedOn,
        asOfDate: asDate(payload.date),
        groupCode: group.code,
      });

      const movedTo = payload.movedToGroup
        ? await this.resolveGroup(tx, companyId, payload.movedToGroup)
        : null;

      const record = await tx.harvestRecord.create({
        data: {
          companyId,
          groupId: group.id,
          harvestedOn: asDate(payload.date),
          grade: payload.grade,
          weightKg: new Prisma.Decimal(payload.kg),
          count: payload.count,
          populationAtTime: payload.populationAtTime ?? group.population,
          destination: payload.destination,
          movedToGroupId: movedTo?.id ?? null,
          notes: payload.notes ?? null,
          recordedById: actor.userId,
        },
      });

      await tx.livestockGroup.update({
        where: { id: group.id },
        data: { population: { decrement: payload.count } },
      });

      // Animals held back as breeding stock leave one population and join
      // another; they have not left the farm.
      if (movedTo) {
        await tx.livestockGroup.update({
          where: { id: movedTo.id },
          data: { population: { increment: payload.count } },
        });
      }

      await this.idempotency.commit(scope, idempotencyKey, payload, record.id, tx);
      await this.audit.write(
        {
          transactionId: record.id,
          module: 'OPERATIONS',
          entityType: 'HarvestRecord',
          entityId: record.id,
          status: 'RECORDED',
          action: AuditAction.CREATE,
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          device: actor.device,
          comments: `${payload.kg} kg from ${group.code}`,
          metadata: { count: payload.count, destination: payload.destination },
        },
        tx,
      );

      return { id: record.id, replayed: false };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Stage changes                                                       */
  /* ------------------------------------------------------------------ */

  async recordStageChange(input: {
    companyId: string;
    actor: WorkflowActor;
    idempotencyKey: string;
    payload: {
      groupCode: string;
      date: string;
      fromStage: string;
      toStage: string;
      fromHouse: string;
      toHouse: string;
      population?: number;
      notes?: string | null;
    };
  }) {
    const { companyId, actor, idempotencyKey, payload } = input;

    if (payload.fromStage === payload.toStage) {
      throw new BadRequestException('The population is already at that stage.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const scope = 'operations.stage-change';
      const reserved = await this.idempotency.reserve(scope, idempotencyKey, payload, tx);
      if (reserved.replayed) return { id: reserved.resultRef!, replayed: true };

      const group = await this.resolveGroup(tx, companyId, payload.groupCode);
      const toPen = await this.resolvePenHouse(tx, companyId, payload.toHouse);

      await this.biologicalAssets.assertStageAgeEligible({
        companyId,
        speciesKey: group.speciesKey,
        breed: group.breed,
        stageName: payload.toStage,
        startedOn: group.startedOn,
        asOfDate: asDate(payload.date),
        groupCode: group.code,
      });

      const record = await tx.stageChange.create({
        data: {
          companyId,
          groupId: group.id,
          changedOn: asDate(payload.date),
          fromStage: payload.fromStage,
          toStage: payload.toStage,
          fromPenHouseId: group.penHouseId,
          toPenHouseId: toPen.id,
          // Recorded from the server's own figure, not the client's. The client
          // sends what it believed; what is true is what the register says.
          population: group.population,
          notes: payload.notes ?? null,
          recordedById: actor.userId,
        },
      });

      // The stage and the house move. The COUNT deliberately does not.
      await tx.livestockGroup.update({
        where: { id: group.id },
        data: { stage: payload.toStage, penHouseId: toPen.id },
      });

      await this.idempotency.commit(scope, idempotencyKey, payload, record.id, tx);
      await this.audit.write(
        {
          transactionId: record.id,
          module: 'OPERATIONS',
          entityType: 'StageChange',
          entityId: record.id,
          status: 'RECORDED',
          action: AuditAction.UPDATE,
          userId: actor.userId,
          ipAddress: actor.ipAddress,
          device: actor.device,
          comments: `${group.code}: ${payload.fromStage} to ${payload.toStage}`,
        },
        tx,
      );

      return { id: record.id, replayed: false };
    });

    // Dr destination stage / Cr source stage, after commit — a house move the
    // worker made is true whether or not the ledger can currently take it.
    if (!result.replayed) {
      const outcome = await this.biologicalAssets.postStageTransfer({
        stageChangeId: result.id,
        actor,
      });
      if (!outcome.posted && outcome.reason) {
        this.logger.warn(`Stage change ${result.id}: ${outcome.reason}`);
      }
    }

    return result;
  }

  /* ------------------------------------------------------------------ */

  /**
   * Populations are addressed by their code, because that is what the phone
   * knows. Scoped by company, so a code belonging to another tenant simply
   * does not exist from here.
   */
  private async resolveGroup(
    tx: Prisma.TransactionClient,
    companyId: string,
    code: string,
  ) {
    const group = await tx.livestockGroup.findFirst({
      where: { companyId, code },
    });
    if (!group) throw new NotFoundException(`No population with the code ${code}.`);
    return group;
  }

  private async resolvePenHouse(
    tx: Prisma.TransactionClient,
    companyId: string,
    name: string,
  ) {
    const penHouse = await tx.penHouse.findFirst({
      where: { farm: { companyId }, OR: [{ name }, { code: name }] },
      include: { farm: true },
    });
    if (!penHouse) throw new NotFoundException(`No house or pen called ${name}.`);
    return penHouse;
  }
}

/** A plain calendar day. Parsed in UTC so it cannot shift by a timezone. */
function asDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) throw new BadRequestException(`${value} is not a date.`);
  return new Date(Date.UTC(year, month - 1, day));
}

function mimeFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl);
  return match?.[1] ?? 'image/jpeg';
}
