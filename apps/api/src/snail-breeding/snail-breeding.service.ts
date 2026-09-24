import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingRuleViolation } from '../common/errors';

const RULE = 'Snail breeding — every egg accounted for';

/**
 * Snail breeding cycles: eggs laid by a breeder cohort, and what hatched.
 * The screen that showed these used to read a fixture; this is the record
 * behind it.
 */
@Injectable()
export class SnailBreedingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(companyId: string) {
    const cycles = await this.prisma.snailBreedingCycle.findMany({
      where: { companyId },
      orderBy: { setOn: 'desc' },
      take: 200,
    });
    const groupIds = [
      ...new Set(cycles.flatMap((c) => [c.breederGroupId, c.hatchlingGroupId].filter((id): id is string => !!id))),
    ];
    const groups = await this.prisma.livestockGroup.findMany({
      where: { id: { in: groupIds } },
      select: { id: true, code: true },
    });
    const codeOf = new Map(groups.map((g) => [g.id, g.code]));

    return cycles.map((cycle) => ({
      id: cycle.id,
      code: cycle.code,
      breederGroupCode: codeOf.get(cycle.breederGroupId) ?? null,
      setOn: cycle.setOn.toISOString().slice(0, 10),
      breeders: cycle.breeders,
      eggsLaid: cycle.eggsLaid,
      status: cycle.status,
      hatchedOn: cycle.hatchedOn?.toISOString().slice(0, 10) ?? null,
      hatchedCount: cycle.hatchedCount,
      unhatchedCount: cycle.unhatchedCount,
      hatchRate:
        cycle.hatchedCount !== null && cycle.eggsLaid > 0
          ? Number(((cycle.hatchedCount / cycle.eggsLaid) * 100).toFixed(1))
          : null,
      hatchlingGroupCode: cycle.hatchlingGroupId ? codeOf.get(cycle.hatchlingGroupId) ?? null : null,
      failedReason: cycle.failedReason,
      notes: cycle.notes,
    }));
  }

  /** The snail cohorts that can breed — the picker behind "Record a cycle". */
  async breederGroups(companyId: string) {
    return this.prisma.livestockGroup.findMany({
      where: { companyId, speciesKey: 'snail', status: 'ACTIVE', population: { gt: 0 } },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, stage: true, population: true, penHouseId: true },
    });
  }

  async record(params: {
    companyId: string;
    actorId: string;
    code: string;
    breederGroupId: string;
    setOn: string;
    breeders: number;
    eggsLaid: number;
    notes?: string | null;
  }) {
    const code = String(params.code ?? '').trim().toUpperCase();
    const breeders = Number(params.breeders);
    const eggsLaid = Number(params.eggsLaid);
    if (!code) throw new BadRequestException('Give the cycle a code.');
    if (!Number.isInteger(breeders) || breeders <= 0) throw new BadRequestException('How many breeders laid?');
    if (!Number.isInteger(eggsLaid) || eggsLaid <= 0) throw new BadRequestException('How many eggs were laid?');

    const group = await this.prisma.livestockGroup.findFirst({
      where: { id: params.breederGroupId, companyId: params.companyId, speciesKey: 'snail' },
    });
    if (!group) throw new BadRequestException('Choose the breeder cohort that laid them.');
    if (breeders > group.population) {
      throw new BadRequestException(`${group.code} has ${group.population} snails — not ${breeders} breeders.`);
    }
    const clash = await this.prisma.snailBreedingCycle.findUnique({
      where: { companyId_code: { companyId: params.companyId, code } },
    });
    if (clash) throw new BadRequestException(`${code} already exists.`);

    const cycle = await this.prisma.snailBreedingCycle.create({
      data: {
        companyId: params.companyId,
        code,
        breederGroupId: group.id,
        setOn: day(params.setOn),
        breeders,
        eggsLaid,
        notes: params.notes?.trim() || null,
        recordedById: params.actorId,
      },
    });
    await this.audit.write({
      transactionId: cycle.id,
      module: 'OPERATIONS',
      entityType: 'SnailBreedingCycle',
      entityId: cycle.id,
      status: 'SET',
      action: AuditAction.CREATE,
      userId: params.actorId,
      comments: `${code}: ${eggsLaid} eggs from ${breeders} breeders of ${group.code}.`,
    });
    return { id: cycle.id, code };
  }

  /**
   * Record what hatched. Hatched + unhatched must equal the eggs laid, and
   * the hatchlings become their own cohort at the Hatchling stage.
   */
  async hatch(params: {
    companyId: string;
    actorId: string;
    cycleId: string;
    hatchedOn: string;
    hatchedCount: number;
    unhatchedCount: number;
    hatchlingGroupCode?: string | null;
  }) {
    const hatched = Number(params.hatchedCount);
    const unhatched = Number(params.unhatchedCount);
    if (!Number.isInteger(hatched) || !Number.isInteger(unhatched) || hatched < 0 || unhatched < 0) {
      throw new BadRequestException('Hatch counts are whole numbers, zero or more.');
    }

    return this.prisma.$transaction(async (tx) => {
      const cycle = await tx.snailBreedingCycle.findFirst({
        where: { id: params.cycleId, companyId: params.companyId },
      });
      if (!cycle) throw new BadRequestException('No such breeding cycle.');
      if (cycle.status !== 'SET') {
        throw new AccountingRuleViolation(RULE, `${cycle.code} is already ${cycle.status.toLowerCase()}.`, {});
      }
      if (hatched + unhatched !== cycle.eggsLaid) {
        throw new AccountingRuleViolation(
          RULE,
          `${cycle.code} had ${cycle.eggsLaid} eggs; hatched (${hatched}) + unhatched (${unhatched}) = ` +
            `${hatched + unhatched}. Every egg has to be one or the other.`,
          { eggsLaid: cycle.eggsLaid },
        );
      }

      let hatchlingGroupId: string | null = null;
      if (hatched > 0) {
        const code = String(params.hatchlingGroupCode ?? '').trim();
        if (!code) throw new BadRequestException('Give the new hatchling cohort a code.');
        const breeder = await tx.livestockGroup.findUniqueOrThrow({ where: { id: cycle.breederGroupId } });
        const taken = await tx.livestockGroup.findFirst({ where: { companyId: params.companyId, code } });
        if (taken) throw new BadRequestException(`A population called ${code} already exists.`);
        const group = await tx.livestockGroup.create({
          data: {
            companyId: params.companyId,
            branchId: breeder.branchId,
            farmId: breeder.farmId,
            penHouseId: breeder.penHouseId,
            code,
            speciesKey: 'snail',
            breed: breeder.breed,
            purpose: 'Growers',
            stage: 'Hatchling',
            openingPopulation: hatched,
            population: hatched,
            startedOn: day(params.hatchedOn),
            source: `Hatched from ${breeder.code} / ${cycle.code}`,
            // Bred, not bought: no purchase price to carry.
            acquisitionCostKobo: 0n,
          },
        });
        hatchlingGroupId = group.id;
      }

      await tx.snailBreedingCycle.update({
        where: { id: cycle.id },
        data: {
          status: 'HATCHED',
          hatchedOn: day(params.hatchedOn),
          hatchedCount: hatched,
          unhatchedCount: unhatched,
          hatchlingGroupId,
        },
      });

      await this.audit.write(
        {
          transactionId: cycle.id,
          module: 'OPERATIONS',
          entityType: 'SnailBreedingCycle',
          entityId: cycle.id,
          status: 'HATCHED',
          action: AuditAction.UPDATE,
          userId: params.actorId,
          comments: `${cycle.code}: ${hatched} hatched, ${unhatched} did not.`,
        },
        tx,
      );
      return { hatchlingGroupId };
    }, { timeout: 15_000 });
  }

  /** A cycle that produced nothing — flooding, predators, a failed medium. */
  async fail(params: { companyId: string; actorId: string; cycleId: string; reason: string }) {
    const reason = String(params.reason ?? '').trim();
    if (!reason) throw new BadRequestException('Say what happened.');
    const cycle = await this.prisma.snailBreedingCycle.findFirst({
      where: { id: params.cycleId, companyId: params.companyId },
    });
    if (!cycle) throw new BadRequestException('No such breeding cycle.');
    if (cycle.status !== 'SET') {
      throw new AccountingRuleViolation(RULE, `${cycle.code} is already ${cycle.status.toLowerCase()}.`, {});
    }
    await this.prisma.snailBreedingCycle.update({
      where: { id: cycle.id },
      data: { status: 'FAILED', failedReason: reason, hatchedCount: 0, unhatchedCount: cycle.eggsLaid },
    });
    await this.audit.write({
      transactionId: cycle.id,
      module: 'OPERATIONS',
      entityType: 'SnailBreedingCycle',
      entityId: cycle.id,
      status: 'FAILED',
      action: AuditAction.UPDATE,
      userId: params.actorId,
      comments: `${cycle.code} failed: ${reason}`,
    });
    return { failed: true };
  }
}

function day(input: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input ?? '').trim());
  if (!match) throw new BadRequestException('Dates are YYYY-MM-DD.');
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}
