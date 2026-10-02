import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountType, AuditAction } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingRuleViolation } from '../common/errors';
import { PostingService } from '../posting/posting.service';
import { PostingControlService } from '../posting-control/posting-control.service';
import { kobo } from '../common/money';
import { nextReference } from '../numbering/numbering';
import type { WorkflowActor } from '../workflow/workflow.types';

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
    private readonly posting: PostingService,
    private readonly postingControl: PostingControlService,
  ) {}

  async list(companyId: string) {
    const cycles = await this.prisma.snailBreedingCycle.findMany({
      where: { companyId },
      orderBy: { setOn: 'desc' },
      take: 200,
    });
    const groupIds = [
      ...new Set(cycles.flatMap((c) => [c.breederGroupId, c.eggGroupId, c.hatchlingGroupId].filter((id): id is string => !!id))),
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
      eggGroupCode: cycle.eggGroupId ? codeOf.get(cycle.eggGroupId) ?? null : null,
      eggValueBasis: cycle.eggValueBasis,
      eggValuePerUnitKobo: cycle.eggValuePerUnitKobo.toString(),
      eggValueEvidence: cycle.eggValueEvidence,
      eggFairValueUnreliableReason: cycle.eggFairValueUnreliableReason,
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

  async eggCostSources(companyId: string) {
    return this.prisma.gLAccount.findMany({
      where: { companyId, accountType: AccountType.EXPENSE, isPostingAccount: true, active: true },
      orderBy: { accountNumber: 'asc' },
      select: { id: true, accountNumber: true, name: true },
    });
  }

  async record(params: {
    companyId: string;
    actor: WorkflowActor;
    code: string;
    breederGroupId: string;
    setOn: string;
    breeders: number;
    eggsLaid: number;
    valueBasis: 'FVLCTS' | 'ATTRIBUTABLE_COST';
    valuePerEggKobo: bigint;
    valueEvidence: string;
    fairValueUnreliableReason?: string | null;
    costSourceAccountId?: string | null;
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

    if (!['FVLCTS', 'ATTRIBUTABLE_COST'].includes(params.valueBasis)) throw new BadRequestException('Choose FVLCTS or attributable cost as the egg valuation basis.');
    if (params.valuePerEggKobo <= 0n) throw new BadRequestException('Viable snail eggs need a positive carrying value per egg.');
    if (!params.valueEvidence?.trim()) throw new BadRequestException('Record the market evidence or attributable-cost support for the egg value.');
    if (params.valueBasis === 'ATTRIBUTABLE_COST' && !params.fairValueUnreliableReason?.trim()) {
      throw new BadRequestException('Explain why fair value is clearly unreliable for these eggs before using attributable cost.');
    }
    if (params.valueBasis === 'FVLCTS' && !params.actor.roles.some((role) => ['FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO'].includes(role))) {
      throw new AccountingRuleViolation('Snail egg fair value recognition', 'A Finance Manager, Finance Controller or CFO must recognize fair-value gains on viable eggs.', {});
    }
    if (params.valueBasis === 'ATTRIBUTABLE_COST' && !params.actor.roles.some((role) => ['FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO'].includes(role))) {
      throw new AccountingRuleViolation('IAS 41 — Fair-value reliability exception', 'Only Finance Manager, Finance Controller or CFO may conclude that fair value is clearly unreliable and approve the attributable-cost exception.', {});
    }
    const context = await this.postingContext(params.companyId, day(params.setOn));
    if (!context) throw new AccountingRuleViolation('Snail egg recognition', 'An open period, posting cost centre and NGN company setup are required to recognize viable eggs.', {});
    const asset = await this.postingControl.resolveApprovedAccount({ companyId: params.companyId, application: 'YifrehSnail', postingGroup: 'SNP-BA-IMM', postingKey: 'BA_CONTROL', on: day(params.setOn) });
    let creditAccountId: string;
    if (params.valueBasis === 'FVLCTS') {
      creditAccountId = (await this.postingControl.resolveApprovedAccount({ companyId: params.companyId, application: 'YifrehSnail', postingGroup: 'SNP-BA-IMM', postingKey: 'BA_FAIR_VALUE_GAIN', on: day(params.setOn) })).glAccountId;
    } else {
      if (!params.costSourceAccountId) throw new BadRequestException('Choose the expense account carrying the attributable egg cost.');
      const source = await this.prisma.gLAccount.findFirst({ where: { id: params.costSourceAccountId, companyId: params.companyId, accountType: AccountType.EXPENSE, isPostingAccount: true, active: true } });
      if (!source) throw new BadRequestException('Choose an active expense posting account for attributable cost.');
      const available = await this.prisma.journalLine.aggregate({ where: { companyId: params.companyId, financialPeriodId: context.period.id, glAccountId: source.id, journalEntry: { status: 'POSTED' } }, _sum: { debitKobo: true, creditKobo: true } });
      const sourceBalance = (available._sum.debitKobo ?? 0n) - (available._sum.creditKobo ?? 0n);
      if (sourceBalance < BigInt(eggsLaid) * params.valuePerEggKobo) throw new AccountingRuleViolation('Snail egg attributable cost', `${source.accountNumber} does not hold enough posted cost in this period to support this egg capitalization.`, { sourceBalance: sourceBalance.toString() });
      creditAccountId = source.id;
    }
    const eggGroupCode = `${code}-EGG`;
    const clashEgg = await this.prisma.livestockGroup.findFirst({ where: { companyId: params.companyId, code: eggGroupCode } });
    if (clashEgg) throw new BadRequestException(`A population called ${eggGroupCode} already exists.`);
    const totalValue = BigInt(eggsLaid) * params.valuePerEggKobo;
    return this.prisma.$transaction(async (tx) => {
      const eggGroup = await tx.livestockGroup.create({ data: {
        companyId: params.companyId, branchId: group.branchId, farmId: group.farmId, penHouseId: group.penHouseId,
        code: eggGroupCode, speciesKey: 'snail', breed: group.breed, purpose: 'Breeding eggs', stage: 'Egg',
        openingPopulation: eggsLaid, population: eggsLaid, startedOn: day(params.setOn), source: `Laid by ${group.code} / ${code}`,
        acquisitionCostKobo: params.valueBasis === 'ATTRIBUTABLE_COST' ? totalValue : 0n,
        currentFvlctsPerUnitKobo: params.valuePerEggKobo,
        measurementBasis: params.valueBasis,
        fairValueUnreliableReason: params.valueBasis === 'ATTRIBUTABLE_COST' ? params.fairValueUnreliableReason!.trim() : null,
        fairValueReliabilityReviewedOn: params.valueBasis === 'ATTRIBUTABLE_COST' ? day(params.setOn) : null,
        fairValueReliabilityEvidence: params.valueBasis === 'ATTRIBUTABLE_COST' ? params.valueEvidence.trim() : null,
      } });
      const cycle = await tx.snailBreedingCycle.create({ data: {
        companyId: params.companyId, code, breederGroupId: group.id, eggGroupId: eggGroup.id, setOn: day(params.setOn),
        breeders, eggsLaid, eggValueBasis: params.valueBasis, eggValuePerUnitKobo: params.valuePerEggKobo,
        eggValueEvidence: params.valueEvidence.trim(), notes: params.notes?.trim() || null, recordedById: params.actor.userId,
        eggFairValueUnreliableReason: params.valueBasis === 'ATTRIBUTABLE_COST' ? params.fairValueUnreliableReason!.trim() : null,
      } });
      const dimensions = this.dimensions(group, context);
      const journalNumber = await nextReference(tx, { companyId: params.companyId, type: 'JV', site: 'GL', date: day(params.setOn) });
      const result = await this.posting.post({
        sourceModule: 'BIOLOGICAL_ASSETS', sourceDocumentType: 'SNAIL_EGG_CYCLE', sourceDocumentId: cycle.id,
        journalNumber,
        journalDate: day(params.setOn), narration: `Recognize ${eggsLaid} viable snail eggs — ${code} at ${params.valueBasis}`,
        ...dimensions,
        idempotencyKey: `snail-egg-recognition:${cycle.id}`,
        actor: params.actor,
        lines: [
          { glAccountId: asset.glAccountId, description: `${eggGroupCode} — viable egg biological asset`, debit: kobo(totalValue), dimensions },
          { glAccountId: creditAccountId, description: `${eggGroupCode} — ${params.valueBasis} recognition`, credit: kobo(totalValue), dimensions },
        ],
      }, tx);
      await this.audit.write({ transactionId: cycle.id, module: 'BIOLOGICAL_ASSETS', entityType: 'SnailBreedingCycle', entityId: cycle.id, status: 'SET', action: AuditAction.POST, userId: params.actor.userId, comments: `${code}: ${eggsLaid} valued eggs from ${breeders} breeders of ${group.code}.`, metadata: { eggGroupId: eggGroup.id, valueBasis: params.valueBasis, valuePerEggKobo: params.valuePerEggKobo.toString(), valueEvidence: params.valueEvidence, fairValueUnreliableReason: params.valueBasis === 'ATTRIBUTABLE_COST' ? params.fairValueUnreliableReason!.trim() : null, journalEntryId: result.journalEntryId } }, tx);
      return { id: cycle.id, code, eggGroupId: eggGroup.id, journalEntryId: result.journalEntryId };
    }, { timeout: 20_000 });
  }

  /**
   * Record what hatched. Hatched + unhatched must equal the eggs laid, and
   * the hatchlings become their own cohort at the Hatchling stage.
   */
  async hatch(params: {
    companyId: string;
    actor: WorkflowActor;
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

    const cycle = await this.prisma.snailBreedingCycle.findFirst({ where: { id: params.cycleId, companyId: params.companyId } });
    if (!cycle) throw new BadRequestException('No such breeding cycle.');
    if (cycle.status !== 'SET') throw new AccountingRuleViolation(RULE, `${cycle.code} is already ${cycle.status.toLowerCase()}.`, {});
    if (!cycle.eggGroupId || cycle.eggValuePerUnitKobo <= 0n) throw new AccountingRuleViolation('Snail egg biological asset', `${cycle.code} has no valued egg cohort. Record attributable cost or FVLCTS before hatching.`, {});
      if (hatched + unhatched !== cycle.eggsLaid) {
        throw new AccountingRuleViolation(
          RULE,
          `${cycle.code} had ${cycle.eggsLaid} eggs; hatched (${hatched}) + unhatched (${unhatched}) = ` +
            `${hatched + unhatched}. Every egg has to be one or the other.`,
          { eggsLaid: cycle.eggsLaid },
        );
      }

    const hatchDate = day(params.hatchedOn);
    const context = await this.postingContext(params.companyId, hatchDate);
    if (!context) throw new AccountingRuleViolation('Snail egg hatch', 'An open period and posting cost centre are required to record hatch losses.', {});
    const configuration = await this.prisma.biologicalAssetConfiguration.findFirst({ where: { companyId: params.companyId, effectiveFrom: { lte: hatchDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: hatchDate } }] }, orderBy: { effectiveFrom: 'desc' } });
    const threshold = configuration ? Number(configuration.abnormalMortalityThresholdPercent) : 2;
    const abnormal = unhatched > 0 && (unhatched / cycle.eggsLaid) * 100 > threshold;
    if (abnormal && !params.actor.roles.some((role) => ['FINANCE_CONTROLLER', 'CFO'].includes(role))) {
      throw new AccountingRuleViolation('IAS 41 — Abnormal egg mortality', `${unhatched} of ${cycle.eggsLaid} eggs failed (${((unhatched / cycle.eggsLaid) * 100).toFixed(1)}%), above the ${threshold}% threshold. A Finance Controller or CFO must record this abnormal loss.`, { thresholdPercent: threshold });
    }
    const asset = await this.postingControl.resolveApprovedAccount({ companyId: params.companyId, application: 'YifrehSnail', postingGroup: 'SNP-BA-IMM', postingKey: 'BA_CONTROL', on: hatchDate });
    const loss = unhatched > 0
      ? await this.postingControl.resolveApprovedAccount({ companyId: params.companyId, application: 'YifrehSnail', postingGroup: 'SNP-BA-IMM', postingKey: abnormal ? 'ABNORMAL_MORTALITY_LOSS' : 'NORMAL_MORTALITY_LOSS', on: hatchDate })
      : null;
    const eggGroup = await this.prisma.livestockGroup.findFirst({ where: { id: cycle.eggGroupId, companyId: params.companyId } });
    if (!eggGroup || eggGroup.stage !== 'Egg' || eggGroup.population !== cycle.eggsLaid) throw new AccountingRuleViolation('Snail egg biological asset', `${cycle.code}'s egg cohort does not reconcile to the recorded viable-egg count.`, {});
    const totalValue = BigInt(cycle.eggsLaid) * cycle.eggValuePerUnitKobo;
    const hatchedValue = BigInt(hatched) * cycle.eggValuePerUnitKobo;
    const unhatchedValue = BigInt(unhatched) * cycle.eggValuePerUnitKobo;

    return this.prisma.$transaction(async (tx) => {
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
            startedOn: hatchDate,
            source: `Hatched from ${breeder.code} / ${cycle.code}`,
            acquisitionCostKobo: cycle.eggValueBasis === 'ATTRIBUTABLE_COST' ? hatchedValue : 0n,
            currentFvlctsPerUnitKobo: cycle.eggValuePerUnitKobo,
            measurementBasis: cycle.eggValueBasis,
            fairValueUnreliableReason: cycle.eggValueBasis === 'ATTRIBUTABLE_COST' ? cycle.eggFairValueUnreliableReason : null,
            fairValueReliabilityReviewedOn: cycle.eggValueBasis === 'ATTRIBUTABLE_COST' ? hatchDate : null,
            fairValueReliabilityEvidence: cycle.eggValueBasis === 'ATTRIBUTABLE_COST' ? cycle.eggValueEvidence : null,
          },
        });
        hatchlingGroupId = group.id;
      }

      await tx.livestockGroup.update({ where: { id: eggGroup.id }, data: { population: 0, status: 'CLOSED', closedOn: hatchDate } });
      let journalEntryId: string | null = null;
      if (unhatched > 0 && loss) {
        const dimensions = this.dimensions(eggGroup, context);
        const journalNumber = await nextReference(tx, { companyId: params.companyId, type: 'JV', site: 'GL', date: hatchDate });
        const lines = [
          ...(hatchedValue > 0n ? [{ glAccountId: asset.glAccountId, description: `${cycle.code} — eggs transferred to hatchling stage`, debit: kobo(hatchedValue), dimensions }] : []),
          { glAccountId: loss.glAccountId, description: `${cycle.code} — ${abnormal ? 'abnormal' : 'normal'} unhatched-egg loss`, debit: kobo(unhatchedValue), dimensions },
          { glAccountId: asset.glAccountId, description: `${cycle.code} — egg-stage carrying value relieved`, credit: kobo(totalValue), dimensions },
        ];
        const posted = await this.posting.post({
          sourceModule: 'BIOLOGICAL_ASSETS', sourceDocumentType: 'SNAIL_EGG_HATCH', sourceDocumentId: cycle.id,
          journalNumber,
          journalDate: hatchDate, narration: `${cycle.code}: ${hatched} hatched, ${unhatched} eggs lost`, ...dimensions,
          idempotencyKey: `snail-egg-hatch:${cycle.id}`, actor: params.actor, lines,
        }, tx);
        journalEntryId = posted.journalEntryId;
      }

      await tx.snailBreedingCycle.update({
        where: { id: cycle.id },
        data: {
          status: 'HATCHED',
          hatchedOn: hatchDate,
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
          userId: params.actor.userId,
          comments: `${cycle.code}: ${hatched} hatched, ${unhatched} did not; egg carrying amount ${totalValue} kobo transferred or written off.`,
          metadata: { hatchlingGroupId, eggGroupId: eggGroup.id, journalEntryId, lossClassification: abnormal ? 'ABNORMAL' : 'NORMAL' },
        },
        tx,
      );
      return { hatchlingGroupId, eggGroupId: eggGroup.id, journalEntryId, lossClassification: abnormal ? 'ABNORMAL' : 'NORMAL' };
    }, { timeout: 15_000 });
  }

  /** Bring forward a previously recorded SET cycle that predates egg valuation. */
  async valueExistingCycle(params: {
    companyId: string; actor: WorkflowActor; cycleId: string;
    valueBasis: 'FVLCTS' | 'ATTRIBUTABLE_COST'; valuePerEggKobo: bigint;
    valueEvidence: string; costSourceAccountId?: string | null; fairValueUnreliableReason?: string | null;
  }) {
    if (!params.actor.roles.some((role) => ['FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO'].includes(role))) {
      throw new AccountingRuleViolation('Snail egg valuation', 'Only Finance Manager, Finance Controller or CFO may value a legacy egg cycle.', {});
    }
    if (!['FVLCTS', 'ATTRIBUTABLE_COST'].includes(params.valueBasis) || params.valuePerEggKobo <= 0n || !params.valueEvidence?.trim()) {
      throw new BadRequestException('Choose a valuation basis, positive value per egg and supporting evidence.');
    }
    if (params.valueBasis === 'ATTRIBUTABLE_COST' && !params.fairValueUnreliableReason?.trim()) {
      throw new BadRequestException('Explain why fair value is clearly unreliable for these eggs before using attributable cost.');
    }
    const cycle = await this.prisma.snailBreedingCycle.findFirst({ where: { id: params.cycleId, companyId: params.companyId } });
    if (!cycle || cycle.status !== 'SET') throw new BadRequestException('Only an open legacy egg cycle can be valued.');
    if (cycle.eggGroupId || cycle.eggValuePerUnitKobo > 0n) throw new BadRequestException('This egg cycle already has a valuation or cohort.');
    const on = new Date();
    const context = await this.postingContext(params.companyId, on);
    if (!context) throw new AccountingRuleViolation('Snail egg valuation', 'An open period, posting cost centre and NGN company setup are required.', {});
    const breeder = await this.prisma.livestockGroup.findFirst({ where: { id: cycle.breederGroupId, companyId: params.companyId } });
    if (!breeder) throw new BadRequestException('The original breeder cohort is missing.');
    const asset = await this.postingControl.resolveApprovedAccount({ companyId: params.companyId, application: 'YifrehSnail', postingGroup: 'SNP-BA-IMM', postingKey: 'BA_CONTROL', on });
    let creditAccountId: string;
    if (params.valueBasis === 'FVLCTS') {
      creditAccountId = (await this.postingControl.resolveApprovedAccount({ companyId: params.companyId, application: 'YifrehSnail', postingGroup: 'SNP-BA-IMM', postingKey: 'BA_FAIR_VALUE_GAIN', on })).glAccountId;
    } else {
      if (!params.costSourceAccountId) throw new BadRequestException('Choose the expense account supporting attributable cost.');
      const source = await this.prisma.gLAccount.findFirst({ where: { id: params.costSourceAccountId, companyId: params.companyId, accountType: AccountType.EXPENSE, isPostingAccount: true, active: true } });
      if (!source) throw new BadRequestException('Choose an active expense posting account.');
      const balances = await this.prisma.journalLine.aggregate({ where: { companyId: params.companyId, financialPeriodId: context.period.id, glAccountId: source.id, journalEntry: { status: 'POSTED' } }, _sum: { debitKobo: true, creditKobo: true } });
      if ((balances._sum.debitKobo ?? 0n) - (balances._sum.creditKobo ?? 0n) < BigInt(cycle.eggsLaid) * params.valuePerEggKobo) throw new AccountingRuleViolation('Snail egg attributable cost', 'The current period does not contain enough posted expense to support this capitalization.', {});
      creditAccountId = source.id;
    }
    const total = BigInt(cycle.eggsLaid) * params.valuePerEggKobo;
    return this.prisma.$transaction(async (tx) => {
      const code = `${cycle.code}-EGG`;
      const duplicate = await tx.livestockGroup.findFirst({ where: { companyId: params.companyId, code } });
      if (duplicate) throw new BadRequestException(`Cohort ${code} already exists; reconcile it before valuing this cycle.`);
      const egg = await tx.livestockGroup.create({ data: {
        companyId: params.companyId, branchId: breeder.branchId, farmId: breeder.farmId, penHouseId: breeder.penHouseId,
        code, speciesKey: 'snail', breed: breeder.breed, purpose: 'Legacy viable eggs', stage: 'Egg',
        openingPopulation: cycle.eggsLaid, population: cycle.eggsLaid, startedOn: on, source: `Legacy cycle ${cycle.code}; valued ${on.toISOString().slice(0, 10)}`,
        acquisitionCostKobo: params.valueBasis === 'ATTRIBUTABLE_COST' ? total : 0n, currentFvlctsPerUnitKobo: params.valuePerEggKobo,
        measurementBasis: params.valueBasis,
        fairValueUnreliableReason: params.valueBasis === 'ATTRIBUTABLE_COST' ? params.fairValueUnreliableReason!.trim() : null,
        fairValueReliabilityReviewedOn: params.valueBasis === 'ATTRIBUTABLE_COST' ? on : null,
        fairValueReliabilityEvidence: params.valueBasis === 'ATTRIBUTABLE_COST' ? params.valueEvidence.trim() : null,
      } });
      await tx.snailBreedingCycle.update({ where: { id: cycle.id }, data: { eggGroupId: egg.id, eggValueBasis: params.valueBasis, eggValuePerUnitKobo: params.valuePerEggKobo, eggValueEvidence: params.valueEvidence.trim(), eggFairValueUnreliableReason: params.valueBasis === 'ATTRIBUTABLE_COST' ? params.fairValueUnreliableReason!.trim() : null } });
      const dimensions = this.dimensions(egg, context);
      const journalNumber = await nextReference(tx, { companyId: params.companyId, type: 'JV', site: 'GL', date: on });
      const posted = await this.posting.post({
        sourceModule: 'BIOLOGICAL_ASSETS', sourceDocumentType: 'SNAIL_EGG_LEGACY_VALUATION', sourceDocumentId: cycle.id,
        journalNumber, journalDate: on, narration: `Recognize legacy viable snail eggs — ${cycle.code} at ${params.valueBasis}`,
        ...dimensions, idempotencyKey: `snail-egg-legacy-valuation:${cycle.id}`, actor: params.actor,
        lines: [
          { glAccountId: asset.glAccountId, description: `${code} — legacy viable egg biological asset`, debit: kobo(total), dimensions },
          { glAccountId: creditAccountId, description: `${code} — ${params.valueBasis} recognition`, credit: kobo(total), dimensions },
        ],
      }, tx);
      await this.audit.write({ transactionId: cycle.id, module: 'BIOLOGICAL_ASSETS', entityType: 'SnailBreedingCycle', entityId: cycle.id, status: 'VALUED', action: AuditAction.POST, userId: params.actor.userId, comments: `${cycle.code}: legacy egg cohort valued at ${total} kobo using ${params.valueBasis}.`, metadata: { eggGroupId: egg.id, valueEvidence: params.valueEvidence, fairValueUnreliableReason: params.valueBasis === 'ATTRIBUTABLE_COST' ? params.fairValueUnreliableReason!.trim() : null, journalEntryId: posted.journalEntryId } }, tx);
      return { eggGroupId: egg.id, journalEntryId: posted.journalEntryId };
    }, { timeout: 20_000 });
  }

  /** A cycle that produced nothing — flooding, predators, a failed medium. */
  async fail(params: { companyId: string; actor: WorkflowActor; cycleId: string; reason: string }) {
    const reason = String(params.reason ?? '').trim();
    if (!reason) throw new BadRequestException('Say what happened.');
    if (!params.actor.roles.some((role) => ['FINANCE_CONTROLLER', 'CFO'].includes(role))) throw new AccountingRuleViolation('IAS 41 — Abnormal egg mortality', 'A failed egg clutch is an abnormal biological-asset loss and must be recorded by a Finance Controller or CFO.', {});
    const cycle = await this.prisma.snailBreedingCycle.findFirst({
      where: { id: params.cycleId, companyId: params.companyId },
    });
    if (!cycle) throw new BadRequestException('No such breeding cycle.');
    if (cycle.status !== 'SET') {
      throw new AccountingRuleViolation(RULE, `${cycle.code} is already ${cycle.status.toLowerCase()}.`, {});
    }
    if (!cycle.eggGroupId || cycle.eggValuePerUnitKobo <= 0n) throw new AccountingRuleViolation('Snail egg biological asset', `${cycle.code} has no valued egg cohort to write off.`, {});
    const failedOn = new Date();
    const context = await this.postingContext(params.companyId, failedOn);
    if (!context) throw new AccountingRuleViolation('IAS 41 — Abnormal egg mortality', 'An open period is required to post this loss.', {});
    const [asset, loss, eggGroup] = await Promise.all([
      this.postingControl.resolveApprovedAccount({ companyId: params.companyId, application: 'YifrehSnail', postingGroup: 'SNP-BA-IMM', postingKey: 'BA_CONTROL', on: failedOn }),
      this.postingControl.resolveApprovedAccount({ companyId: params.companyId, application: 'YifrehSnail', postingGroup: 'SNP-BA-IMM', postingKey: 'ABNORMAL_MORTALITY_LOSS', on: failedOn }),
      this.prisma.livestockGroup.findFirst({ where: { id: cycle.eggGroupId, companyId: params.companyId } }),
    ]);
    if (!eggGroup || eggGroup.population !== cycle.eggsLaid) throw new AccountingRuleViolation('Snail egg biological asset', `${cycle.code}'s egg cohort does not reconcile before write-off.`, {});
    const totalValue = BigInt(cycle.eggsLaid) * cycle.eggValuePerUnitKobo;
    return this.prisma.$transaction(async (tx) => {
      const dimensions = this.dimensions(eggGroup, context);
      const journalNumber = await nextReference(tx, { companyId: params.companyId, type: 'JV', site: 'GL', date: failedOn });
      const posted = await this.posting.post({
        sourceModule: 'BIOLOGICAL_ASSETS', sourceDocumentType: 'SNAIL_EGG_FAILURE', sourceDocumentId: cycle.id,
        journalNumber,
        journalDate: failedOn, narration: `${cycle.code}: abnormal loss of ${cycle.eggsLaid} viable snail eggs — ${reason}`,
        ...dimensions, idempotencyKey: `snail-egg-failure:${cycle.id}`, actor: params.actor,
        lines: [
          { glAccountId: loss.glAccountId, description: `${cycle.code} — abnormal egg mortality`, debit: kobo(totalValue), dimensions },
          { glAccountId: asset.glAccountId, description: `${cycle.code} — egg carrying amount written off`, credit: kobo(totalValue), dimensions },
        ],
      }, tx);
      await tx.livestockGroup.update({ where: { id: eggGroup.id }, data: { population: 0, status: 'CLOSED', closedOn: failedOn } });
      await tx.snailBreedingCycle.update({ where: { id: cycle.id }, data: { status: 'FAILED', failedReason: reason, hatchedCount: 0, unhatchedCount: cycle.eggsLaid } });
      await this.audit.write({ transactionId: cycle.id, module: 'BIOLOGICAL_ASSETS', entityType: 'SnailBreedingCycle', entityId: cycle.id, status: 'FAILED', action: AuditAction.POST, userId: params.actor.userId, comments: `${cycle.code} failed: ${reason}; abnormal loss ${totalValue} kobo.`, metadata: { journalEntryId: posted.journalEntryId, eggGroupId: eggGroup.id } }, tx);
      return { failed: true, journalEntryId: posted.journalEntryId };
    }, { timeout: 20_000 });
  }

  private async postingContext(companyId: string, on: Date) {
    const [period, costCentre, company] = await Promise.all([
      this.prisma.financialPeriod.findFirst({ where: { financialYear: { companyId }, startDate: { lte: on }, endDate: { gte: on }, status: 'OPEN' }, select: { id: true, financialYearId: true } }),
      this.prisma.costCentre.findFirst({ where: { companyId, active: true, postingAllowed: true }, orderBy: { code: 'asc' }, select: { id: true } }),
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, include: { baseCurrency: { select: { code: true } } } }),
    ]);
    if (!period || !costCentre || company.baseCurrency.code !== 'NGN') return null;
    return { period, costCentre, company };
  }

  private dimensions(group: { companyId: string; branchId: string; farmId: string; penHouseId: string }, context: { period: { id: string; financialYearId: string }; costCentre: { id: string }; company: { baseCurrencyId: string } }) {
    return {
      companyId: group.companyId, branchId: group.branchId,
      financialYearId: context.period.financialYearId, financialPeriodId: context.period.id,
      currencyId: context.company.baseCurrencyId, exchangeRate: '1',
      costCentreId: context.costCentre.id, farmId: group.farmId, penHouseId: group.penHouseId,
    };
  }
}

function day(input: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input ?? '').trim());
  if (!match) throw new BadRequestException('Dates are YYYY-MM-DD.');
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}
