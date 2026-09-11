import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { AccountingRuleViolation } from '../common/errors';

/**
 * PoultryPro egg production, incubation and hatching — Poultry_Egg_Production
 * P-EGG-01 through P-EGG-08, PCR-067/068/069.
 *
 * Real client data, not previously extracted: the workbook's own sheet gives
 * a complete stage-by-stage flow with real GL account numbers, and
 * `posting-control.json` already carries three Approved, Active posting keys
 * for exactly this (PCR-067/068/069) — resolving to accounts 130215/130216/
 * 130210, which were seeded and mapped in `seed-biological-assets.ts`
 * (`POULTRY_STAGE_ACCOUNTS` already reserves 130215/130216) and then sat
 * completely unused, the same "stranded — zero callers" shape this session
 * keeps finding.
 *
 * Deliberately carries NO GL posting in this pass. PCR-067's own basis is
 * "Approved egg quantity × policy value" and the client's own Decision
 * Register (DEC-002, "Egg recognition") is still Open — assigning a per-egg
 * value here would be inventing the fair-value policy the client has not yet
 * set. This mirrors `recordHarvest()`'s own already-accepted precedent
 * (US-897-011): the quantity/lifecycle model is real and enforced end to
 * end, the accounting consequence activates once the client answers DEC-002.
 */
@Injectable()
export class PoultryEggService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * P-EGG-01/02, PCR-067 — daily laying plus collection/grading in one record.
   *
   * Idempotency-keyed like every other outbox-queued write (Rule 6) — this is
   * reached from the offline sync queue, where a retry after a lost response
   * is the expected case, not the exception.
   */
  async recordCollection(params: {
    companyId: string;
    sourceGroupId: string;
    code: string;
    collectedOn: Date;
    hatchingCount: number;
    tableCount: number;
    rejectCount: number;
    notes?: string | null;
    recordedById: string;
    idempotencyKey: string;
  }) {
    if (params.hatchingCount < 0 || params.tableCount < 0 || params.rejectCount < 0) {
      throw new BadRequestException('Egg counts cannot be negative.');
    }
    const totalCount = params.hatchingCount + params.tableCount + params.rejectCount;
    if (totalCount <= 0) {
      throw new BadRequestException('At least one egg must be recorded.');
    }

    return this.prisma.$transaction(async (tx) => {
      const scope = 'poultry-egg.collection';
      const reserved = await this.idempotency.reserve(scope, params.idempotencyKey, params, tx);
      if (reserved.replayed) return tx.eggCollectionBatch.findUniqueOrThrow({ where: { id: reserved.resultRef! } });

      const group = await tx.livestockGroup.findUniqueOrThrow({
        where: { id: params.sourceGroupId },
      });
      if (group.speciesKey !== 'poultry') {
        throw new BadRequestException('Egg collection is a PoultryPro event — the source group is not poultry.');
      }

      const batch = await tx.eggCollectionBatch.create({
        data: {
          companyId: params.companyId,
          branchId: group.branchId,
          sourceGroupId: group.id,
          farmId: group.farmId,
          penHouseId: group.penHouseId,
          code: params.code.trim(),
          collectedOn: params.collectedOn,
          totalCount,
          hatchingCount: params.hatchingCount,
          tableCount: params.tableCount,
          rejectCount: params.rejectCount,
          hatchingRemaining: params.hatchingCount,
          notes: params.notes ?? null,
          recordedById: params.recordedById,
        },
      });

      await this.idempotency.commit(scope, params.idempotencyKey, params, batch.id, tx);
      return batch;
    });
  }

  /** P-EGG-04, PCR-068 — set hatching eggs into an incubator. */
  async setIncubation(params: {
    companyId: string;
    eggBatchId: string;
    code: string;
    setOn: Date;
    setQuantity: number;
    incubator?: string | null;
    notes?: string | null;
    recordedById: string;
    idempotencyKey: string;
  }) {
    if (params.setQuantity <= 0) {
      throw new BadRequestException('Set quantity must be greater than zero.');
    }

    return this.prisma.$transaction(async (tx) => {
      const scope = 'poultry-egg.incubation';
      const reserved = await this.idempotency.reserve(scope, params.idempotencyKey, params, tx);
      if (reserved.replayed) return tx.incubationBatch.findUniqueOrThrow({ where: { id: reserved.resultRef! } });

      const eggBatch = await tx.eggCollectionBatch.findUniqueOrThrow({
        where: { id: params.eggBatchId },
      });
      if (params.setQuantity > eggBatch.hatchingRemaining) {
        throw new AccountingRuleViolation(
          'Poultry_Egg_Production P-EGG-04 — Set + rejected eggs = available eggs',
          `Only ${eggBatch.hatchingRemaining} hatching egg(s) remain on ${eggBatch.code}; ` +
            `${params.setQuantity} were requested for incubation.`,
          { eggBatchId: eggBatch.id, hatchingRemaining: eggBatch.hatchingRemaining, requested: params.setQuantity },
        );
      }

      const batch = await tx.incubationBatch.create({
        data: {
          companyId: params.companyId,
          eggBatchId: eggBatch.id,
          code: params.code.trim(),
          setOn: params.setOn,
          setQuantity: params.setQuantity,
          incubator: params.incubator ?? null,
          notes: params.notes ?? null,
          recordedById: params.recordedById,
        },
      });

      await tx.eggCollectionBatch.update({
        where: { id: eggBatch.id },
        data: { hatchingRemaining: eggBatch.hatchingRemaining - params.setQuantity },
      });

      await this.idempotency.commit(scope, params.idempotencyKey, params, batch.id, tx);
      return batch;
    });
  }

  /**
   * P-EGG-07, PCR-069 — hatch pull. Creates the day-old-chick `LivestockGroup`
   * (stage 'Chick', matching `POULTRY_STAGE_ACCOUNTS`) when any chicks
   * survived; a complete loss records the event with no group created.
   */
  async recordHatch(params: {
    companyId: string;
    incubationBatchId: string;
    hatchedOn: Date;
    hatchedCount: number;
    unhatchedCount: number;
    damagedCount: number;
    chickGroupCode?: string;
    breed?: string;
    purpose?: string;
    penHouseId?: string;
    recordedById: string;
    idempotencyKey: string;
  }) {
    if (params.hatchedCount < 0 || params.unhatchedCount < 0 || params.damagedCount < 0) {
      throw new BadRequestException('Hatch counts cannot be negative.');
    }

    return this.prisma.$transaction(async (tx) => {
      const scope = 'poultry-egg.hatch';
      const reserved = await this.idempotency.reserve(scope, params.idempotencyKey, params, tx);
      if (reserved.replayed) {
        const replayedHatch = await tx.hatchEvent.findUniqueOrThrow({ where: { id: reserved.resultRef! } });
        return { ...replayedHatch, chickGroupId: replayedHatch.chickGroupId };
      }

      const incubation = await tx.incubationBatch.findUniqueOrThrow({
        where: { id: params.incubationBatchId },
        include: { eggBatch: { include: { sourceGroup: true } }, hatchEvent: true },
      });
      if (incubation.hatchEvent) {
        throw new AccountingRuleViolation(
          'Poultry_Egg_Production P-EGG-07 — one hatch event per incubation batch',
          `${incubation.code} has already been hatched.`,
          { incubationBatchId: incubation.id },
        );
      }

      const total = params.hatchedCount + params.unhatchedCount + params.damagedCount;
      if (total !== incubation.setQuantity) {
        throw new AccountingRuleViolation(
          'Poultry_Egg_Production P-EGG-07 — chicks + unhatched/loss = eggs set',
          `${incubation.code} set ${incubation.setQuantity} egg(s); hatched (${params.hatchedCount}) + ` +
            `unhatched (${params.unhatchedCount}) + damaged (${params.damagedCount}) = ${total}.`,
          { incubationBatchId: incubation.id, setQuantity: incubation.setQuantity, total },
        );
      }

      let chickGroupId: string | null = null;
      if (params.hatchedCount > 0) {
        const source = incubation.eggBatch.sourceGroup;
        if (!params.chickGroupCode?.trim()) {
          throw new BadRequestException('A code for the new day-old-chick group is required.');
        }
        const chickGroup = await tx.livestockGroup.create({
          data: {
            companyId: params.companyId,
            branchId: source.branchId,
            farmId: source.farmId,
            penHouseId: params.penHouseId ?? incubation.eggBatch.penHouseId ?? source.penHouseId,
            code: params.chickGroupCode.trim(),
            speciesKey: 'poultry',
            breed: params.breed ?? source.breed,
            purpose: params.purpose ?? 'Growers',
            stage: 'Chick',
            openingPopulation: params.hatchedCount,
            population: params.hatchedCount,
            startedOn: params.hatchedOn,
            source: `Hatched from ${incubation.eggBatch.code} / ${incubation.code}`,
            acquisitionCostKobo: 0n,
          },
        });
        chickGroupId = chickGroup.id;
      }

      const hatch = await tx.hatchEvent.create({
        data: {
          companyId: params.companyId,
          incubationBatchId: incubation.id,
          hatchedOn: params.hatchedOn,
          hatchedCount: params.hatchedCount,
          unhatchedCount: params.unhatchedCount,
          damagedCount: params.damagedCount,
          chickGroupId,
          recordedById: params.recordedById,
        },
      });

      await tx.incubationBatch.update({
        where: { id: incubation.id },
        data: { status: 'HATCHED' },
      });

      await this.idempotency.commit(scope, params.idempotencyKey, params, hatch.id, tx);
      return { ...hatch, chickGroupId };
    });
  }

  async listEggBatches(companyId: string) {
    return this.prisma.eggCollectionBatch.findMany({
      where: { companyId },
      include: {
        sourceGroup: { select: { code: true, breed: true } },
        incubationBatches: { select: { id: true, code: true, setQuantity: true, status: true } },
      },
      orderBy: { collectedOn: 'desc' },
    });
  }

  async listIncubationBatches(companyId: string) {
    return this.prisma.incubationBatch.findMany({
      where: { companyId },
      include: {
        eggBatch: { select: { code: true } },
        hatchEvent: { select: { hatchedCount: true, unhatchedCount: true, damagedCount: true } },
      },
      orderBy: { setOn: 'desc' },
    });
  }
}
