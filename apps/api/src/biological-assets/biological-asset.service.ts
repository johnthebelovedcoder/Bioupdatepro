import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AccountType,
  AuditAction,
  NormalBalance,
  Prisma,
  ValuationDirection,
  WorkflowStatus,
} from '@bioassetpro/database';
import { chartVersionOf, holdsRearingInAsset as holdsRearingInAssetOn } from '../chart/chart';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../posting/posting.service';
import { WorkflowService } from '../workflow/workflow.service';
import { AuditService } from '../audit/audit.service';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';
import type { WorkflowActor } from '../workflow/workflow.types';
import { RearingCostService } from './rearing-cost.service';

/**
 * The biological-asset ledger — Consolidated Reference §43, §61, §67.
 *
 * The gap this closes was the client's own example: "as soon as I receive the
 * snail into the inventory... the biological asset is debited and the Goods
 * Received Not Yet Invoiced is credited." A population's cost was captured on
 * `LivestockGroup.acquisitionCostKobo` and went no further; a mortality event
 * removed a count and never touched a carrying value; a stage change moved a
 * population between pens and never between accounts. Three real events with
 * no accounting consequence, in a product whose entire purpose is that every
 * event has one.
 *
 * Three kinds of posting here, and they are treated differently on purpose.
 *
 * ACQUISITION, MORTALITY and STAGE TRANSFER post immediately, the moment the
 * operational record commits — the same convention `operations-posting
 * .service.ts` already uses for feed and treatment. None of them involves a
 * judgement call: acquisition cost is what was paid, a stage transfer moves
 * carrying value at cost with no gain (§61.6), and mortality removes value at
 * the PRIOR fair value per unit (formula 3) — a fact about what already
 * existed, not an opinion about what exists now.
 *
 * VALUATION is different. Fixing a current fair value means asserting a market
 * price and a cost to sell, and §61.6 names two people for it — a preparer and
 * a Finance Controller — because a farm's whole quarter of profit can turn
 * on that number. It goes through the same `WorkflowTransaction` engine as
 * every other approval-gated document, not a bespoke two-step field: Rule 2
 * forbids a second maker-checker mechanism, and building one here would be
 * exactly that.
 */

/**
 * The biological-asset accounts a company needs, by number — the same set
 * `ProvisioningService.provisionCompany()` seeds for a brand new company,
 * duplicated here for the reason every other duplication in this codebase
 * gives: the seed only runs at signup, so a company registered before this
 * chart existed (or before a given account was added to it) has none of
 * these rows, permanently, with no admin screen to add them from. Every
 * resolver below falls back to creating its account from this table rather
 * than only throwing — the same "record it now, cost it once a real account
 * exists" posture `postAcquisition` already uses for the transaction that
 * depends on them.
 *
 * 640300/640500 (abnormal loss) are not in `ProvisioningService.ACCOUNTS` at
 * all yet — no company, new or old, has ever had them — so this is the only
 * place they get created, for every company alike.
 */
const DEFAULT_ACCOUNTS: Record<
  string,
  { name: string; type: AccountType; normal: NormalBalance }
> = {
  '210200': { name: 'GRNI', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT },
  '130200': { name: 'BA — Snail Breeders', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  '130201': { name: 'BA — Snail Eggs', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  '130202': { name: 'BA — Snail Hatchlings', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  '130203': { name: 'BA — Snail Juveniles', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  '130204': { name: 'BA — Market Snails', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  '130210': { name: 'BA — Poultry', type: AccountType.ASSET, normal: NormalBalance.DEBIT },
  '420100': {
    name: 'Fair-Value Gain/Loss — Snails',
    type: AccountType.REVENUE,
    normal: NormalBalance.CREDIT,
  },
  '420200': {
    name: 'Fair-Value Gain/Loss — Poultry',
    type: AccountType.REVENUE,
    normal: NormalBalance.CREDIT,
  },
  '640300': {
    name: 'Abnormal Biological Loss — Snails',
    type: AccountType.EXPENSE,
    normal: NormalBalance.DEBIT,
  },
  '640500': {
    name: 'Abnormal Biological Loss — Poultry',
    type: AccountType.EXPENSE,
    normal: NormalBalance.DEBIT,
  },
};

/** Duplicated from `ProvisioningService`'s own map of the same name — see its header. */
const SNAIL_STAGE_ACCOUNTS: Record<string, string> = {
  Breeder: '130200',
  Egg: '130201',
  Hatchling: '130202',
  Juvenile: '130203',
  Grower: '130203',
  'Market-ready': '130204',
  'Breeder cohort': '130200',
  Growers: '130203',
  Juveniles: '130203',
};

/** Duplicated from `ProvisioningService`'s own map of the same name — see its header. */
const POULTRY_STAGE_ACCOUNTS: Record<string, string> = {
  Chick: '130210',
  Grower: '130210',
  'Market-ready': '130210',
  'Point-of-lay': '130210',
  Layer: '130210',
  Broiler: '130210',
  Pullet: '130210',
  Cockerel: '130210',
  Breeder: '130210',
};

@Injectable()
export class BiologicalAssetService {
  private readonly logger = new Logger(BiologicalAssetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
    private readonly workflow: WorkflowService,
    private readonly audit: AuditService,
    /** Weighted-average rearing cost; exposed for the callers that remove animals. */
    readonly rearing: RearingCostService,
  ) {}

  /** Require an IAS 41 carrying value evidenced on the reporting/disposal date. */
  async assertValuedOn(params: {
    companyId: string;
    groupId: string;
    startedOn: Date;
    currentFvlctsPerUnitKobo: bigint | null;
    on: Date;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const start = new Date(Date.UTC(params.on.getUTCFullYear(), params.on.getUTCMonth(), params.on.getUTCDate()));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    if (params.currentFvlctsPerUnitKobo === null || params.currentFvlctsPerUnitKobo <= 0n) {
      throw new AccountingRuleViolation('IAS 41 — Biological asset valuation', 'This population has no carrying value. Record attributable cost or an evidenced FVLCTS valuation before harvest or sale.', { groupId: params.groupId });
    }
    // Initial recognition is valid on the placement date. Later FVLCTS exits
    // need that day's posted valuation; populations on the narrow cost
    // exception need a dated Finance review that fair value remains unreliable.
    const placedThatDay = params.startedOn >= start && params.startedOn < end;
    if (placedThatDay) return;
    const db = params.tx ?? this.prisma;
    const group = await db.livestockGroup.findFirst({
      where: { id: params.groupId, companyId: params.companyId },
      select: { measurementBasis: true, fairValueUnreliableReason: true, fairValueReliabilityReviewedOn: true, fairValueReliabilityEvidence: true },
    });
    if (group?.measurementBasis === 'ATTRIBUTABLE_COST') {
      const reviewedToday = group.fairValueReliabilityReviewedOn?.getTime() === start.getTime();
      if (reviewedToday && group.fairValueUnreliableReason?.trim() && group.fairValueReliabilityEvidence?.trim()) return;
      throw new AccountingRuleViolation(
        'IAS 41 — Cost exception reliability review',
        `Finance must document that fair value remains clearly unreliable on ${start.toISOString().slice(0, 10)}, or post an FVLCTS valuation before harvest or sale.`,
        { groupId: params.groupId, on: start.toISOString().slice(0, 10) },
      );
    }
    const valuation = await db.biologicalAssetValuation.findFirst({
      where: { companyId: params.companyId, groupId: params.groupId, status: WorkflowStatus.POSTED, valuationDate: { gte: start, lt: end } },
      select: { id: true },
    });
    if (!valuation) {
      throw new AccountingRuleViolation('IAS 41 — Pre-harvest/pre-sale valuation', 'Record and post an evidenced FVLCTS valuation for this population on the harvest or sale date before removing animals.', { groupId: params.groupId, on: start.toISOString().slice(0, 10) });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Account resolution                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * The GL account a stage carries its biological asset in.
   *
   * Refuses rather than guesses, matching every other resolver in this
   * codebase: a stage with no mapped account — 130204 "Market Snails" today,
   * since the product has no stage that reaches it — must not silently post
   * to whatever account happened to be nearby.
   */
  async stageAccount(params: {
    companyId: string;
    speciesKey: string;
    stage: string;
  }): Promise<{ glAccountId: string; accountNumber: string; accountName: string }> {
    const row = await this.prisma.biologicalAssetStageAccount.findUnique({
      where: {
        companyId_speciesKey_stage: {
          companyId: params.companyId,
          speciesKey: params.speciesKey,
          stage: params.stage,
        },
      },
      include: { glAccount: true },
    });

    if (row && row.active) {
      return {
        glAccountId: row.glAccountId,
        accountNumber: row.glAccount.accountNumber,
        accountName: row.glAccount.name,
      };
    }

    const healed = await this.ensureStageAccountMapping(params.companyId, params.speciesKey, params.stage);
    if (healed) return healed;

    throw new AccountingRuleViolation(
      'Consolidated Reference §67 — Biological asset stage account',
      `No approved GL account is mapped for ${params.speciesKey} at stage "${params.stage}". ` +
        `The event is recorded; it stays unposted until an account is configured.`,
      { speciesKey: params.speciesKey, stage: params.stage },
    );
  }

  /**
   * The mapping `ProvisioningService.provisionCompany()` already creates for
   * every stage in `SNAIL_STAGE_ACCOUNTS`/`POULTRY_STAGE_ACCOUNTS`, applied
   * lazily for a company that predates it (or predates a given stage being
   * added to that table). Returns `null` — never throws — for a stage this
   * table genuinely has no opinion on (130204 "Market Snails" today), so
   * `stageAccount`'s own "will not guess" refusal still fires for that case.
   */
  private async ensureStageAccountMapping(
    companyId: string,
    speciesKey: string,
    stage: string,
  ): Promise<{ glAccountId: string; accountNumber: string; accountName: string } | null> {
    const normalizedSpeciesKey = speciesKey.trim().toLowerCase();
    const table = normalizedSpeciesKey === 'snail' ? SNAIL_STAGE_ACCOUNTS : POULTRY_STAGE_ACCOUNTS;
    const accountNumber = table[stage];
    if (!accountNumber) return null;

    const account = await this.ensureAccount(companyId, accountNumber);
    if (!account) return null;

    const created = await this.prisma.biologicalAssetStageAccount.upsert({
      where: { companyId_speciesKey_stage: { companyId, speciesKey, stage } },
      update: {},
      create: { companyId, speciesKey, stage, glAccountId: account.id },
    });
    if (!created.active) return null;

    return { glAccountId: account.id, accountNumber: account.accountNumber, accountName: account.name };
  }

  /**
   * The account itself, self-healed from `DEFAULT_ACCOUNTS` when a company
   * predates it — see that table's own header. Returns `null` — never
   * throws — for a number this table does not recognise, so every caller's
   * existing "no such account" error still fires for a genuinely unknown one.
   */
  private async ensureAccount(
    companyId: string,
    accountNumber: string,
  ): Promise<{ id: string; accountNumber: string; name: string } | null> {
    const existing = await this.prisma.gLAccount.findFirst({
      where: { companyId, accountNumber, active: true },
      select: { id: true, accountNumber: true, name: true },
    });
    if (existing) return existing;

    const seed = DEFAULT_ACCOUNTS[accountNumber];
    if (!seed) return null;

    return this.prisma.gLAccount.create({
      data: {
        companyId,
        accountNumber,
        name: seed.name,
        accountType: seed.type,
        normalBalance: seed.normal,
      },
      select: { id: true, accountNumber: true, name: true },
    });
  }

  /**
   * Refuses a stage transfer, sale or harvest that the population has not
   * lived long enough to reach (§ SNAIL_AGE_TRACKER / POULTRY_AGE_TRACKER —
   * US-897-009/010).
   *
   * Deliberately silent, not a refusal, when there is nothing to check
   * against: a breed with no SpeciesBreed row, or a stage that row does not
   * name a threshold for. That mirrors the workbook's own age tracker, which
   * flags an inconsistent age/stage pairing as REVIEW rather than blocking —
   * and matches the non-blocking design already chosen for placement
   * (SpeciesBreed governs data, it does not gate free-text breed entry).
   */
  async assertStageAgeEligible(params: {
    companyId: string;
    speciesKey: string;
    breed: string;
    stageName: string;
    startedOn: Date;
    asOfDate: Date;
    groupCode: string;
  }): Promise<void> {
    const speciesBreed = await this.prisma.speciesBreed.findFirst({
      where: { companyId: params.companyId, speciesKey: params.speciesKey, name: params.breed, active: true },
      include: { stages: { where: { stageName: params.stageName } } },
    });
    const threshold = speciesBreed?.stages[0];
    if (!threshold) return;

    const ageDays = Math.floor(
      (params.asOfDate.getTime() - params.startedOn.getTime()) / 86_400_000,
    );
    if (ageDays < threshold.minDay) {
      throw new AccountingRuleViolation(
        'SNAIL_AGE_TRACKER / POULTRY_AGE_TRACKER — minimum age per stage',
        `${params.groupCode} is ${ageDays} day(s) old — "${params.stageName}" needs at least ` +
          `${threshold.minDay} for ${params.breed}.`,
        { groupCode: params.groupCode, stage: params.stageName, ageDays, minDay: threshold.minDay },
      );
    }
  }

  private async grniAccount(companyId: string): Promise<{ glAccountId: string }> {
    const account = await this.ensureAccount(companyId, '210200');
    if (!account) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §66 — Posting chart',
        'No active GRNI account (210200) exists. A biological receipt cannot post without one.',
        { accountNumber: '210200' },
      );
    }
    return { glAccountId: account.id };
  }

  async fairValueAccount(
    companyId: string,
    speciesKey: string,
  ): Promise<{ glAccountId: string }> {
    // 420100 Snails, 420200 Poultry — the same numbering pattern the workbook
    // uses throughout (species offset by 100).
    const normalizedSpeciesKey = speciesKey.trim().toLowerCase();
    const accountNumber = normalizedSpeciesKey === 'snail' ? '420100' : '420200';
    const account = await this.ensureAccount(companyId, accountNumber);
    if (!account) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §66 — Posting chart',
        `No active fair-value gain/loss account (${accountNumber}) exists for ${speciesKey}.`,
        { accountNumber },
      );
    }
    return { glAccountId: account.id };
  }

  private async abnormalLossAccount(
    companyId: string,
    speciesKey: string,
  ): Promise<{ glAccountId: string }> {
    const normalizedSpeciesKey = speciesKey.trim().toLowerCase();
    const accountNumber = normalizedSpeciesKey === 'snail' ? '640300' : '640500';
    const account = await this.ensureAccount(companyId, accountNumber);
    if (!account) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §66 — Posting chart',
        `No active abnormal biological loss account (${accountNumber}) exists for ${speciesKey}.`,
        { accountNumber },
      );
    }
    return { glAccountId: account.id };
  }

  /** The open period and cost centre a posting needs. Null when either is missing. */
  async postingContext(companyId: string, on: Date) {
    const [period, costCentre, company] = await Promise.all([
      this.prisma.financialPeriod.findFirst({
        where: { financialYear: { companyId }, startDate: { lte: on }, endDate: { gte: on }, status: 'OPEN' },
        select: { id: true, financialYearId: true },
      }),
      this.prisma.costCentre.findFirst({
        where: { companyId, active: true, postingAllowed: true },
        orderBy: { code: 'asc' },
        select: { id: true },
      }),
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
    ]);
    if (!period || !costCentre) return null;
    return { period, costCentre, company };
  }

  /* ------------------------------------------------------------------ */
  /* Acquisition — PCR-037/061                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Dr [stage account] / Cr GRNI, for a population's stated acquisition cost.
   *
   * §61.6's own table offers three possible credits — AP, GRNI or Bank — and
   * leaves the choice open; `POSTING_COA_MASTER` narrows it no further
   * (PCR-037-CR is the unresolved expression "210200/210100"). GRNI is what
   * this service uses, because it is the same account every other purchase
   * receipt in this codebase credits (PCR-004/005/006 all do), and treating a
   * biological receipt differently from a material one would be the invented
   * distinction, not the consistent choice.
   */
  async postAcquisition(params: { groupId: string; actor: WorkflowActor }): Promise<{
    posted: boolean;
    reason?: string;
  }> {
    const group = await this.prisma.livestockGroup.findUniqueOrThrow({
      where: { id: params.groupId },
    });

    if (group.acquisitionCostKobo <= 0n) {
      return { posted: false, reason: 'No acquisition cost recorded.' };
    }
    if (group.currentFvlctsPerUnitKobo !== null) {
      return { posted: false, reason: 'Already posted.' };
    }

    try {
      const stage = await this.stageAccount({
        companyId: group.companyId,
        speciesKey: group.speciesKey,
        stage: group.stage,
      });
      const grni = await this.grniAccount(group.companyId);
      const context = await this.postingContext(group.companyId, group.startedOn);
      if (!context) {
        return { posted: false, reason: 'No open period or cost centre for the placement date.' };
      }

      const dimensions = {
        companyId: group.companyId,
        branchId: group.branchId,
        financialYearId: context.period.financialYearId,
        financialPeriodId: context.period.id,
        currencyId: context.company.baseCurrencyId,
        exchangeRate: '1',
        costCentreId: context.costCentre.id,
        farmId: group.farmId,
        penHouseId: group.penHouseId,
      };

      const result = await this.posting.post({
        sourceModule: 'BIOLOGICAL_ASSETS',
        sourceDocumentType: 'LIVESTOCK_GROUP',
        sourceDocumentId: group.id,
        journalNumber: `BA-ACQ-${group.id.slice(0, 8).toUpperCase()}`,
        journalDate: group.startedOn,
        narration: `${group.code} acquired — ${group.openingPopulation} ${group.breed}`,
        ...dimensions,
        lines: [
          {
            glAccountId: stage.glAccountId,
            description: `Biological asset — ${group.code}`,
            debit: kobo(group.acquisitionCostKobo),
            dimensions,
          },
          {
            glAccountId: grni.glAccountId,
            description: `GRNI — ${group.code}`,
            credit: kobo(group.acquisitionCostKobo),
            dimensions,
          },
        ],
        idempotencyKey: `ba-acquisition:${group.id}`,
        actor: params.actor,
      });

      await this.prisma.livestockGroup.update({
        where: { id: group.id },
        data: {
          currentFvlctsPerUnitKobo:
            group.acquisitionCostKobo / BigInt(Math.max(1, group.openingPopulation)),
        },
      });
      void result;
      return { posted: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Acquisition for ${group.code} did not post: ${message}`);
      return { posted: false, reason: message };
    }
  }

  /* ------------------------------------------------------------------ */
  /* Mortality — PCR-044/045/065/066                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Dr fair-value loss (normal) or abnormal-loss (abnormal) / Cr [stage
   * account], at the mortality quantity × the PRIOR FVLCTS per unit —
   * formula 3. Classification is decided here, against the company's
   * configured threshold, not left to whoever is recording the count.
   */
  async postMortality(params: { mortalityRecordId: string; actor: WorkflowActor }): Promise<{
    posted: boolean;
    reason?: string;
  }> {
    const mortality = await this.prisma.mortalityRecord.findUniqueOrThrow({
      where: { id: params.mortalityRecordId },
      include: { dailyRecord: { include: { group: true } } },
    });

    if (mortality.journalEntryId) return { posted: false, reason: 'Already posted.' };

    const group = mortality.dailyRecord.group;

    /*
     * The rearing cost the dead animals had absorbed leaves with them, at
     * weighted average — whatever happens to their carrying value below, and
     * whether or not the population was ever valued. Called after the round
     * committed, so the population has already fallen by this count.
     * Idempotent, so a retry of this posting never relieves twice.
     */
    await this.rearing.relieve({
      companyId: group.companyId,
      groupId: group.id,
      event: 'MORTALITY',
      sourceId: mortality.id,
      count: mortality.quantity,
      populationBefore: group.population + mortality.quantity,
      occurredOn: mortality.dailyRecord.recordedOn,
      actor: params.actor,
    });
    if (group.currentFvlctsPerUnitKobo === null) {
      return { posted: false, reason: 'No carrying value yet — acquisition has not posted.' };
    }
    if (group.currentFvlctsPerUnitKobo <= 0n) {
      // A population with no carrying value has nothing to lose. Recorded,
      // not posted — a zero journal would be noise in the register.
      return { posted: false, reason: 'Carrying value is zero; nothing to post.' };
    }

    try {
      const config = await this.prisma.biologicalAssetConfiguration.findFirst({
        where: {
          companyId: group.companyId,
          effectiveFrom: { lte: mortality.dailyRecord.recordedOn },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: mortality.dailyRecord.recordedOn } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      const thresholdPercent = config
        ? Number(config.abnormalMortalityThresholdPercent)
        : 2;
      const dayRatePercent = (mortality.quantity / Math.max(1, group.population)) * 100;
      const abnormal = dayRatePercent > thresholdPercent;

      /*
       * Normal mortality still posts straight away — a worker recording an
       * ordinary loss should never wait on a reviewer. Abnormal mortality is
       * different: it is real money leaving the balance sheet on a claim
       * nobody has looked at yet, the exact gap the register named for
       * `ProductionOrderService`'s own abnormal-loss claims and closed there
       * first. Recorded here (classification set, journalEntryId still null —
       * the same "visible but unposted" convention the processing side uses)
       * and submitted through the same maker-checker engine rather than
       * posted directly; `postApprovedAbnormalMortality()` posts on approval.
       */
      if (abnormal) {
        await this.prisma.mortalityRecord.update({
          where: { id: mortality.id },
          data: { classification: 'ABNORMAL' },
        });

        const context = await this.postingContext(group.companyId, mortality.dailyRecord.recordedOn);
        if (!context) {
          return { posted: false, reason: 'No open period or cost centre for that date.' };
        }
        const valueKobo = BigInt(mortality.quantity) * group.currentFvlctsPerUnitKobo;

        await this.workflow.submit({
          companyId: group.companyId,
          transactionType: 'BIOLOGICAL_ASSET_ABNORMAL_MORTALITY',
          module: 'biological-assets',
          documentType: 'MortalityRecord',
          documentId: mortality.id,
          documentReference: `BA-MORT-${mortality.id.slice(0, 8).toUpperCase()}`,
          amount: kobo(valueKobo),
          currencyId: context.company.baseCurrencyId,
          branchId: group.branchId,
          farmId: group.farmId,
          costCentreId: context.costCentre.id,
          actor: params.actor,
        });

        return { posted: false, reason: 'Abnormal mortality claim submitted for approval.' };
      }

      const stage = await this.stageAccount({
        companyId: group.companyId,
        speciesKey: group.speciesKey,
        stage: group.stage,
      });
      const fairValue = await this.fairValueAccount(group.companyId, group.speciesKey);
      const context = await this.postingContext(group.companyId, mortality.dailyRecord.recordedOn);
      if (!context) {
        return { posted: false, reason: 'No open period or cost centre for that date.' };
      }

      const valueKobo = BigInt(mortality.quantity) * group.currentFvlctsPerUnitKobo;

      const dimensions = {
        companyId: group.companyId,
        branchId: group.branchId,
        financialYearId: context.period.financialYearId,
        financialPeriodId: context.period.id,
        currencyId: context.company.baseCurrencyId,
        exchangeRate: '1',
        costCentreId: context.costCentre.id,
        farmId: group.farmId,
        penHouseId: group.penHouseId,
      };

      const result = await this.posting.post({
        sourceModule: 'BIOLOGICAL_ASSETS',
        sourceDocumentType: 'MORTALITY_RECORD',
        sourceDocumentId: mortality.id,
        journalNumber: `BA-MORT-${mortality.id.slice(0, 8).toUpperCase()}`,
        journalDate: mortality.dailyRecord.recordedOn,
        narration: `${mortality.quantity} normal deaths — ${group.code}`,
        ...dimensions,
        lines: [
          {
            glAccountId: fairValue.glAccountId,
            description: `Normal mortality — ${group.code}`,
            debit: kobo(valueKobo),
            dimensions,
          },
          {
            glAccountId: stage.glAccountId,
            description: `Carrying value written off — ${group.code}`,
            credit: kobo(valueKobo),
            dimensions,
          },
        ],
        idempotencyKey: `ba-mortality:${mortality.id}`,
        actor: params.actor,
      });

      await this.prisma.mortalityRecord.update({
        where: { id: mortality.id },
        data: {
          classification: 'NORMAL',
          journalEntryId: result.journalEntryId,
        },
      });

      return { posted: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Mortality ${mortality.id} did not post: ${message}`);
      return { posted: false, reason: message };
    }
  }

  /** Posts the journal for an approved abnormal-mortality claim. */
  async postApprovedAbnormalMortality(params: {
    mortalityRecordId: string;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string }> {
    const mortality = await params.tx.mortalityRecord.findUniqueOrThrow({
      where: { id: params.mortalityRecordId },
      include: { dailyRecord: { include: { group: true } } },
    });

    if (mortality.journalEntryId) {
      throw new AccountingRuleViolation(
        'Rule 2 — Posted transactions are immutable',
        `Mortality ${mortality.id} is already posted.`,
        {},
      );
    }

    const group = mortality.dailyRecord.group;
    const stage = await this.stageAccount({ companyId: group.companyId, speciesKey: group.speciesKey, stage: group.stage });
    const abnormalLoss = await this.abnormalLossAccount(group.companyId, group.speciesKey);
    const context = await this.postingContext(group.companyId, mortality.dailyRecord.recordedOn);
    if (!context) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §8 — Financial calendar',
        `No open period covers ${mortality.dailyRecord.recordedOn.toISOString().slice(0, 10)}.`,
        {},
      );
    }

    const valueKobo = BigInt(mortality.quantity) * (group.currentFvlctsPerUnitKobo ?? 0n);
    const dimensions = {
      companyId: group.companyId,
      branchId: group.branchId,
      financialYearId: context.period.financialYearId,
      financialPeriodId: context.period.id,
      currencyId: context.company.baseCurrencyId,
      exchangeRate: '1',
      costCentreId: context.costCentre.id,
      farmId: group.farmId,
      penHouseId: group.penHouseId,
    };

    const result = await this.posting.post(
      {
        sourceModule: 'BIOLOGICAL_ASSETS',
        sourceDocumentType: 'MORTALITY_RECORD',
        sourceDocumentId: mortality.id,
        journalNumber: `BA-MORT-${mortality.id.slice(0, 8).toUpperCase()}`,
        journalDate: mortality.dailyRecord.recordedOn,
        narration: `${mortality.quantity} abnormal deaths — ${group.code}`,
        ...dimensions,
        lines: [
          {
            glAccountId: abnormalLoss.glAccountId,
            description: `Abnormal mortality — ${group.code}`,
            debit: kobo(valueKobo),
            dimensions,
          },
          {
            glAccountId: stage.glAccountId,
            description: `Carrying value written off — ${group.code}`,
            credit: kobo(valueKobo),
            dimensions,
          },
        ],
        idempotencyKey: `ba-mortality:${mortality.id}`,
        actor: params.actor,
      },
      params.tx,
    );

    await params.tx.mortalityRecord.update({
      where: { id: mortality.id },
      data: { journalEntryId: result.journalEntryId },
    });

    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Stage transfer — PCR-039/040/041                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Dr [destination stage] / Cr [source stage], at the transferred carrying
   * value — population moved × current FVLCTS per unit. "The stage transfer
   * alone creates no second gain" (§61.6): the per-unit value does not change,
   * only which account holds it.
   */
  async postStageTransfer(params: { stageChangeId: string; actor: WorkflowActor }): Promise<{
    posted: boolean;
    reason?: string;
  }> {
    const change = await this.prisma.stageChange.findUniqueOrThrow({
      where: { id: params.stageChangeId },
      include: { group: true },
    });

    if (change.journalEntryId) return { posted: false, reason: 'Already posted.' };

    const group = change.group;
    if (group.currentFvlctsPerUnitKobo === null || group.currentFvlctsPerUnitKobo <= 0n) {
      return { posted: false, reason: 'No carrying value to transfer.' };
    }

    try {
      const from = await this.stageAccount({
        companyId: group.companyId,
        speciesKey: group.speciesKey,
        stage: change.fromStage,
      });
      const to = await this.stageAccount({
        companyId: group.companyId,
        speciesKey: group.speciesKey,
        stage: change.toStage,
      });
      const context = await this.postingContext(group.companyId, change.changedOn);
      if (!context) {
        return { posted: false, reason: 'No open period or cost centre for that date.' };
      }

      const valueKobo = BigInt(change.population) * group.currentFvlctsPerUnitKobo;
      if (valueKobo <= 0n) return { posted: false, reason: 'Nothing to transfer.' };

      const dimensions = {
        companyId: group.companyId,
        branchId: group.branchId,
        financialYearId: context.period.financialYearId,
        financialPeriodId: context.period.id,
        currencyId: context.company.baseCurrencyId,
        exchangeRate: '1',
        costCentreId: context.costCentre.id,
        farmId: group.farmId,
        penHouseId: change.toPenHouseId,
      };

      const result = await this.posting.post({
        sourceModule: 'BIOLOGICAL_ASSETS',
        sourceDocumentType: 'STAGE_CHANGE',
        sourceDocumentId: change.id,
        journalNumber: `BA-STG-${change.id.slice(0, 8).toUpperCase()}`,
        journalDate: change.changedOn,
        narration: `${group.code}: ${change.fromStage} → ${change.toStage}`,
        ...dimensions,
        lines: [
          {
            glAccountId: to.glAccountId,
            description: `${group.code} into ${change.toStage}`,
            debit: kobo(valueKobo),
            dimensions,
          },
          {
            glAccountId: from.glAccountId,
            description: `${group.code} out of ${change.fromStage}`,
            credit: kobo(valueKobo),
            dimensions,
          },
        ],
        idempotencyKey: `ba-stage-transfer:${change.id}`,
        actor: params.actor,
      });

      await this.prisma.stageChange.update({
        where: { id: change.id },
        data: { journalEntryId: result.journalEntryId },
      });

      return { posted: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Stage transfer ${change.id} did not post: ${message}`);
      return { posted: false, reason: message };
    }
  }

  /* ------------------------------------------------------------------ */
  /* Disposal — PCR-050/073                                             */
  /* ------------------------------------------------------------------ */

  private async disposalExpenseAccount(
    companyId: string,
    speciesKey: string,
  ): Promise<{ glAccountId: string }> {
    // PCR-050-DR (COGS — Live Snails) / PCR-073-DR (COGS — Live Birds/Eggs),
    // read straight off POSTING_COA_MASTER — not the usual species-offset-by-
    // 100 pattern the other resolvers here use, so this is looked up by its
    // actual stated code rather than derived.
    const normalizedSpeciesKey = speciesKey.trim().toLowerCase();
    const accountNumber = normalizedSpeciesKey === 'snail' ? '510100' : '510300';
    const account = await this.prisma.gLAccount.findFirst({
      where: { companyId, accountNumber, active: true },
      select: { id: true },
    });
    if (!account) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §66 — Posting chart',
        `No active COGS account (${accountNumber}) exists for ${speciesKey} live sales.`,
        { accountNumber },
      );
    }
    return { glAccountId: account.id };
  }

  /**
   * Dr COGS / Cr [stage account], for a population sold or transferred out
   * live — §61.3 formula 6, "Quantity sold or transferred to processing x
   * FVLCTS per unit". This is what `rollForward()`'s reconciliation was
   * missing: `trade.service.ts` decrements `LivestockGroup.population` the
   * moment a sale is recorded, and until this posts, nothing removes the
   * carrying value those animals took with them.
   *
   * Posts immediately, same tier as mortality and stage transfer — the rate
   * is read off the group's own current FVLCTS/unit, not asserted, so there
   * is no judgement call for a Financial Controller to make here.
   */
  async postDisposal(params: {
    groupId: string;
    quantity: number;
    occurredOn: Date;
    /** How they left (batch-profile.service DISPOSAL_METHODS). A sale unless said otherwise. */
    method?: 'SOLD' | 'SLAUGHTERED' | 'CULLED' | 'GIFTED' | 'DESTROYED';
    actor: WorkflowActor;
  }): Promise<{ posted: boolean; reason?: string }> {
    const group = await this.prisma.livestockGroup.findUniqueOrThrow({
      where: { id: params.groupId },
    });

    if (group.currentFvlctsPerUnitKobo === null || group.currentFvlctsPerUnitKobo <= 0n) {
      // Nothing to derecognise — matches the mortality convention. Not
      // recorded either: a zero-value row would only exist to be filtered
      // back out by `rollForward()`, and every other resolver here already
      // refuses rather than write a placeholder.
      return { posted: false, reason: 'No carrying value yet — acquisition has not posted.' };
    }

    const rateKobo = group.currentFvlctsPerUnitKobo;
    const valueKobo = BigInt(params.quantity) * rateKobo;

    const disposal = await this.prisma.livestockGroupDisposal.create({
      data: {
        groupId: group.id,
        quantity: params.quantity,
        fvlctsPerUnitKobo: rateKobo,
        carryingAmountKobo: valueKobo,
        occurredOn: params.occurredOn,
        method: params.method ?? 'SOLD',
      },
    });

    try {
      const stage = await this.stageAccount({
        companyId: group.companyId,
        speciesKey: group.speciesKey,
        stage: group.stage,
      });
      const expense = await this.disposalExpenseAccount(group.companyId, group.speciesKey);
      const context = await this.postingContext(group.companyId, params.occurredOn);
      if (!context) {
        return { posted: false, reason: 'No open period or cost centre for that date.' };
      }

      const dimensions = {
        companyId: group.companyId,
        branchId: group.branchId,
        financialYearId: context.period.financialYearId,
        financialPeriodId: context.period.id,
        currencyId: context.company.baseCurrencyId,
        exchangeRate: '1',
        costCentreId: context.costCentre.id,
        farmId: group.farmId,
        penHouseId: group.penHouseId,
      };

      const result = await this.posting.post({
        sourceModule: 'BIOLOGICAL_ASSETS',
        sourceDocumentType: 'LIVESTOCK_GROUP_DISPOSAL',
        sourceDocumentId: disposal.id,
        journalNumber: `BA-DISP-${disposal.id.slice(0, 8).toUpperCase()}`,
        journalDate: params.occurredOn,
        narration: `${params.quantity} sold live — ${group.code}`,
        ...dimensions,
        lines: [
          {
            glAccountId: expense.glAccountId,
            description: `Carrying value of ${group.code} sold`,
            debit: kobo(valueKobo),
            dimensions,
          },
          {
            glAccountId: stage.glAccountId,
            description: `Carrying value derecognised — ${group.code}`,
            credit: kobo(valueKobo),
            dimensions,
          },
        ],
        idempotencyKey: `ba-disposal:${disposal.id}`,
        actor: params.actor,
      });

      await this.prisma.livestockGroupDisposal.update({
        where: { id: disposal.id },
        data: { journalEntryId: result.journalEntryId },
      });

      return { posted: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Disposal ${disposal.id} did not post: ${message}`);
      return { posted: false, reason: message };
    }
  }

  /* ------------------------------------------------------------------ */
  /* Market price list (US-897-011) — prefills the valuation form         */
  /* ------------------------------------------------------------------ */

  /**
   * The market price currently in force for every species/breed the company
   * has priced — one row per (speciesKey, breed), the most recent whose
   * effective range covers today.
   *
   * Read-only reference data for the valuation form's default fill. §61.6
   * still requires the preparer's own evidence reference, and the form still
   * lets both numbers be overridden — this only governs where the starting
   * point comes from.
   */
  async listCurrentMarketPrices(companyId: string) {
    const today = new Date(Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    ));

    return this.prisma.marketPriceList.findMany({
      where: {
        companyId,
        effectiveFrom: { lte: today },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
      },
      orderBy: [{ speciesKey: 'asc' }, { breed: 'asc' }, { effectiveFrom: 'desc' }],
      distinct: ['speciesKey', 'breed'],
    });
  }

  /**
   * Set a species/breed's market price, effective from a date — closes
   * whatever was open before it rather than overwriting it (same pattern as
   * `ItemStandardCost`), so a valuation raised under the old price stays
   * reproducible against what was actually in force then.
   */
  async setMarketPrice(params: {
    companyId: string;
    actor: WorkflowActor;
    speciesKey: string;
    breed: string;
    marketPricePerUnitKobo: bigint;
    costsToSellPerUnitKobo: bigint;
    evidenceReference: string;
    effectiveFrom: Date;
  }) {
    if (params.marketPricePerUnitKobo <= 0n) {
      throw new BadRequestException('A market price must be greater than zero.');
    }
    if (!params.evidenceReference.trim()) {
      throw new BadRequestException('A market price needs an evidence reference.');
    }

    const day = new Date(Date.UTC(
      params.effectiveFrom.getUTCFullYear(),
      params.effectiveFrom.getUTCMonth(),
      params.effectiveFrom.getUTCDate(),
    ));
    const previousDay = new Date(day);
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);

    return this.prisma.$transaction(async (tx) => {
      // A same-day correction replaces outright rather than leaving a row
      // that was "effective" for zero days — effectiveTo can't precede its
      // own effectiveFrom, so closing it the normal way is not an option.
      await tx.marketPriceList.deleteMany({
        where: {
          companyId: params.companyId,
          speciesKey: params.speciesKey,
          breed: params.breed,
          effectiveFrom: day,
        },
      });

      const superseded = await tx.marketPriceList.findFirst({
        where: {
          companyId: params.companyId,
          speciesKey: params.speciesKey,
          breed: params.breed,
          effectiveTo: null,
          effectiveFrom: { lt: day },
        },
      });

      await tx.marketPriceList.updateMany({
        where: {
          companyId: params.companyId,
          speciesKey: params.speciesKey,
          breed: params.breed,
          effectiveTo: null,
          effectiveFrom: { lt: day },
        },
        data: { effectiveTo: previousDay },
      });

      const created = await tx.marketPriceList.create({
        data: {
          companyId: params.companyId,
          speciesKey: params.speciesKey,
          breed: params.breed,
          marketPricePerUnitKobo: params.marketPricePerUnitKobo,
          costsToSellPerUnitKobo: params.costsToSellPerUnitKobo,
          evidenceReference: params.evidenceReference.trim(),
          effectiveFrom: day,
          createdById: params.actor.userId,
        },
      });

      await this.audit.write(
        {
          transactionId: created.id,
          module: 'biological-assets',
          entityType: 'MarketPriceList',
          entityId: created.id,
          status: 'ACTIVE',
          action: AuditAction.CREATE,
          userId: params.actor.userId,
          ipAddress: params.actor.ipAddress ?? null,
          device: params.actor.device ?? null,
          comments: `${params.speciesKey}/${params.breed} priced at ${params.marketPricePerUnitKobo} kobo from ${day.toISOString().slice(0, 10)}`,
          oldValue: superseded
            ? {
                marketPricePerUnitKobo: superseded.marketPricePerUnitKobo.toString(),
                costsToSellPerUnitKobo: superseded.costsToSellPerUnitKobo.toString(),
              }
            : null,
          newValue: {
            marketPricePerUnitKobo: params.marketPricePerUnitKobo.toString(),
            costsToSellPerUnitKobo: params.costsToSellPerUnitKobo.toString(),
          },
        },
        tx,
      );

      return created;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Valuation — PCR-046/047/070/071, maker-checker via WorkflowService  */
  /* ------------------------------------------------------------------ */

  /** Finance's dated reassessment for a population using IAS 41's cost exception. */
  async reviewFairValueReliability(params: {
    companyId: string;
    groupId: string;
    reviewedOn: Date;
    stillUnreliable: boolean;
    reason: string;
    evidenceReference: string;
    actor: WorkflowActor;
  }) {
    if (!params.actor.roles.some((role) => ['FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO'].includes(role))) {
      throw new ForbiddenException('Only Finance Manager, Finance Controller or CFO may approve the IAS 41 cost exception.');
    }
    if (!params.stillUnreliable) {
      throw new AccountingRuleViolation(
        'IAS 41 — Fair value is now reliable',
        'Record and post an FVLCTS valuation dated on the review date. That moves the population back to fair-value measurement.',
        { groupId: params.groupId, reviewedOn: params.reviewedOn.toISOString().slice(0, 10) },
      );
    }
    if (!params.reason?.trim() || !params.evidenceReference?.trim()) {
      throw new BadRequestException('Record why fair value remains clearly unreliable and cite the review evidence.');
    }
    const group = await this.prisma.livestockGroup.findFirst({
      where: { id: params.groupId, companyId: params.companyId, status: 'ACTIVE', population: { gt: 0 } },
    });
    if (!group) throw new NotFoundException('No active biological-asset population to review.');
    if (group.measurementBasis !== 'ATTRIBUTABLE_COST') {
      throw new AccountingRuleViolation('IAS 41 — Cost exception review', `${group.code} is not measured at attributable cost. Use an FVLCTS valuation for this population.`, {});
    }
    const reviewedOn = new Date(Date.UTC(params.reviewedOn.getUTCFullYear(), params.reviewedOn.getUTCMonth(), params.reviewedOn.getUTCDate()));
    if (reviewedOn > new Date(new Date().setUTCHours(0, 0, 0, 0))) {
      throw new BadRequestException('A fair-value reliability review cannot be dated in the future.');
    }
    const updated = await this.prisma.livestockGroup.update({
      where: { id: group.id },
      data: {
        fairValueUnreliableReason: params.reason.trim(),
        fairValueReliabilityReviewedOn: reviewedOn,
        fairValueReliabilityEvidence: params.evidenceReference.trim(),
      },
    });
    await this.audit.write({
      transactionId: group.id,
      module: 'biological-assets',
      entityType: 'LivestockGroup',
      entityId: group.id,
      status: 'REVIEWED',
      action: AuditAction.CONFIG_CHANGE,
      userId: params.actor.userId,
      comments: `Finance confirmed fair value remains clearly unreliable for ${group.code} as of ${reviewedOn.toISOString().slice(0, 10)}.`,
      metadata: { measurementBasis: 'ATTRIBUTABLE_COST', reason: params.reason.trim(), evidenceReference: params.evidenceReference.trim() },
    });
    return { groupId: updated.id, measurementBasis: updated.measurementBasis, reviewedOn: reviewedOn.toISOString().slice(0, 10) };
  }

  /**
   * Raise a valuation. Computes formulas 1, 2 and 4-5 immediately so the
   * preparer sees the effect before submitting; posts nothing until it is
   * approved.
   */
  async requestValuation(params: {
    companyId: string;
    groupId: string;
    valuationDate: Date;
    marketPricePerUnitKobo: bigint;
    costsToSellPerUnitKobo: bigint;
    evidenceReference: string;
    actor: WorkflowActor;
  }): Promise<{ id: string }> {
    const group = await this.prisma.livestockGroup.findFirstOrThrow({
      where: { id: params.groupId, companyId: params.companyId },
    });

    if (params.marketPricePerUnitKobo <= 0n) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §61.6 — Valuation evidence',
        'A market price is required. §61.6 blocks a valuation with no approved market evidence.',
        {},
      );
    }
    // UAT-014: nothing disposed of is valued, and every value has its evidence.
    if (group.status !== 'ACTIVE' || group.population <= 0) {
      throw new AccountingRuleViolation(
        'UAT-014 — Value only what is held',
        `${group.code} has no animals left to value (${group.population} live, ${group.status.toLowerCase()}). Sold, harvested or dead animals are not revalued.`,
        { groupCode: group.code, population: group.population, status: group.status },
      );
    }
    if (!params.evidenceReference?.trim()) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §61.6 — Valuation evidence',
        'Name the market evidence for this price — a quotation, market survey or recent sale.',
        {},
      );
    }
    if (params.costsToSellPerUnitKobo < 0n || params.costsToSellPerUnitKobo >= params.marketPricePerUnitKobo) {
      throw new AccountingRuleViolation(
        'IAS 41 — Fair value less costs to sell',
        `Costs to sell (${params.costsToSellPerUnitKobo} kobo) must be zero or more and less than the market price (${params.marketPricePerUnitKobo} kobo).`,
        {},
      );
    }
    if (params.valuationDate < group.startedOn || (group.closedOn && params.valuationDate > group.closedOn)) {
      throw new AccountingRuleViolation(
        'UAT-014 — Value only what is held',
        `${group.code} was held from ${group.startedOn.toISOString().slice(0, 10)}${group.closedOn ? ` to ${group.closedOn.toISOString().slice(0, 10)}` : ''}; it cannot be valued on ${params.valuationDate.toISOString().slice(0, 10)}.`,
        {},
      );
    }

    const priorFvlcts = group.currentFvlctsPerUnitKobo ?? 0n;
    const currentFvlcts = params.marketPricePerUnitKobo - params.costsToSellPerUnitKobo;
    /*
     * On the client's chart a flock's rearing cost is capitalised into the
     * same Biological Assets account its fair value sits in (chart.ts), so
     * the carrying amount before this valuation is prior fair value PLUS the
     * rearing cost held since. The gain is measured against both, and the
     * cost is absorbed into the new fair value when this posts. On the old
     * chart rearing cost is held apart (1501) and none is absorbed.
     */
    const version = await chartVersionOf(this.prisma, params.companyId);
    const holdsRearingInAsset = holdsRearingInAssetOn(version, group.speciesKey);
    const rearingCostAbsorbedKobo = holdsRearingInAsset ? await this.rearing.remaining(group.id) : 0n;
    // Formula 4: closing quantity × (current − prior), less capitalised cost.
    // Population is the closing quantity — nothing has moved between raising
    // this and reading it.
    const gainLossKobo = BigInt(group.population) * (currentFvlcts - priorFvlcts) - rearingCostAbsorbedKobo;
    const direction: ValuationDirection = gainLossKobo >= 0n ? 'GAIN' : 'LOSS';

    const valuation = await this.prisma.biologicalAssetValuation.create({
      data: {
        companyId: params.companyId,
        groupId: group.id,
        stage: group.stage,
        valuationDate: params.valuationDate,
        openingQuantity: group.population,
        closingQuantity: group.population,
        priorFvlctsPerUnitKobo: priorFvlcts,
        marketPricePerUnitKobo: params.marketPricePerUnitKobo,
        costsToSellPerUnitKobo: params.costsToSellPerUnitKobo,
        currentFvlctsPerUnitKobo: currentFvlcts,
        direction,
        gainLossKobo: gainLossKobo < 0n ? -gainLossKobo : gainLossKobo,
        rearingCostAbsorbedKobo,
        evidenceReference: params.evidenceReference,
        preparedById: params.actor.userId,
      },
    });

    const result = await this.workflow.submit({
      companyId: params.companyId,
      transactionType: 'BA_VALUATION',
      module: 'biological-assets',
      documentType: 'BiologicalAssetValuation',
      documentId: valuation.id,
      documentReference: `BAV-${valuation.id.slice(0, 8).toUpperCase()}`,
      amount: kobo(gainLossKobo < 0n ? -gainLossKobo : gainLossKobo),
      currencyId: (await this.prisma.company.findUniqueOrThrow({ where: { id: params.companyId } }))
        .baseCurrencyId,
      farmId: group.farmId,
      actor: params.actor,
    });

    await this.prisma.biologicalAssetValuation.update({
      where: { id: valuation.id },
      data: { workflowTransactionId: result.transactionId, status: WorkflowStatus.SUBMITTED },
    });

    return { id: valuation.id };
  }

  /** Called by the registered workflow posting handler once approved. */
  async postApprovedValuation(params: {
    valuationId: string;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string | null }> {
    const valuation = await params.tx.biologicalAssetValuation.findUniqueOrThrow({
      where: { id: params.valuationId },
      include: { group: true },
    });

    if (valuation.status === WorkflowStatus.POSTED) {
      throw new AccountingRuleViolation(
        'Rule 2 — Posted transactions are immutable',
        `${valuation.id} is already posted.`,
        {},
      );
    }

    const stage = await this.stageAccount({
      companyId: valuation.companyId,
      speciesKey: valuation.group.speciesKey,
      stage: valuation.stage,
    });
    const fairValue = await this.fairValueAccount(valuation.companyId, valuation.group.speciesKey);
    const context = await this.postingContext(valuation.companyId, valuation.valuationDate);
    if (!context) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §8 — Financial calendar',
        `No open period covers ${valuation.valuationDate.toISOString().slice(0, 10)}.`,
        {},
      );
    }

    const dimensions = {
      companyId: valuation.companyId,
      branchId: valuation.group.branchId,
      financialYearId: context.period.financialYearId,
      financialPeriodId: context.period.id,
      currencyId: context.company.baseCurrencyId,
      exchangeRate: '1',
      costCentreId: context.costCentre.id,
      farmId: valuation.group.farmId,
      penHouseId: valuation.group.penHouseId,
    };

    const isGain = valuation.direction === 'GAIN';

    /*
     * A valuation that confirms the carrying value (a month-end count at an
     * unchanged price) is evidence, not a movement: it is recorded and
     * approved with no journal, since a journal of zero is refused. Found by
     * the 40-step rehearsal's month-end valuation (step 34).
     */
    const result = valuation.gainLossKobo === 0n ? { journalEntryId: null } : await this.posting.post(
      {
        sourceModule: 'BIOLOGICAL_ASSETS',
        sourceDocumentType: 'BIOLOGICAL_ASSET_VALUATION',
        sourceDocumentId: valuation.id,
        journalNumber: `BAV-${valuation.id.slice(0, 8).toUpperCase()}`,
        journalDate: valuation.valuationDate,
        narration: `FVLCTS ${isGain ? 'gain' : 'loss'} — ${valuation.group.code}`,
        ...dimensions,
        lines: isGain
          ? [
              {
                glAccountId: stage.glAccountId,
                description: `${valuation.group.code} — fair-value gain`,
                debit: kobo(valuation.gainLossKobo),
                dimensions,
              },
              {
                glAccountId: fairValue.glAccountId,
                description: `${valuation.group.code} — fair-value gain`,
                credit: kobo(valuation.gainLossKobo),
                dimensions,
              },
            ]
          : [
              {
                glAccountId: fairValue.glAccountId,
                description: `${valuation.group.code} — fair-value loss`,
                debit: kobo(valuation.gainLossKobo),
                dimensions,
              },
              {
                glAccountId: stage.glAccountId,
                description: `${valuation.group.code} — fair-value loss`,
                credit: kobo(valuation.gainLossKobo),
                dimensions,
              },
            ],
        idempotencyKey: `ba-valuation:${valuation.id}`,
        actor: params.actor,
      },
      params.tx,
    );

    await params.tx.biologicalAssetValuation.update({
      where: { id: valuation.id },
      data: { status: WorkflowStatus.POSTED, journalEntryId: result.journalEntryId },
    });
    await params.tx.livestockGroup.update({
      where: { id: valuation.groupId },
      data: {
        currentFvlctsPerUnitKobo: valuation.currentFvlctsPerUnitKobo,
        measurementBasis: 'FVLCTS',
        fairValueUnreliableReason: null,
        fairValueReliabilityReviewedOn: null,
        fairValueReliabilityEvidence: null,
      },
    });

    // The rearing cost this valuation measured against is now part of the
    // flock's fair value: record it leaving the rearing-cost ledger, so the
    // next death, sale or valuation does not count it again. No journal of
    // its own — it never left the account; the valuation journal restated it.
    if (valuation.rearingCostAbsorbedKobo > 0n) {
      await params.tx.livestockRearingRelief.create({
        data: {
          companyId: valuation.companyId,
          groupId: valuation.groupId,
          eventType: 'REVALUED',
          sourceId: valuation.id,
          count: 0,
          populationBefore: valuation.group.population,
          amountKobo: valuation.rearingCostAbsorbedKobo,
          journalEntryId: result.journalEntryId,
          occurredOn: valuation.valuationDate,
        },
      });
    }

    return { journalEntryId: result.journalEntryId };
  }

  /* ------------------------------------------------------------------ */
  /* Roll-forward — formula 7, read-only verification                    */
  /* ------------------------------------------------------------------ */

  /**
   * The §61.3 reconciliation for one population: closing BA against
   * opening BA minus mortality loss plus growth/price gain minus disposal —
   * should be zero. Read-only; nothing here posts.
   */
  async rollForward(groupId: string) {
    const group = await this.prisma.livestockGroup.findUniqueOrThrow({ where: { id: groupId } });

    const [mortalityJournals, valuations, disposals] = await Promise.all([
      this.prisma.mortalityRecord.findMany({
        where: { dailyRecord: { groupId }, journalEntryId: { not: null } },
        select: { journalEntryId: true },
      }),
      this.prisma.biologicalAssetValuation.findMany({
        where: { groupId, status: WorkflowStatus.POSTED },
        orderBy: { valuationDate: 'asc' },
      }),
      // Read what was actually posted, not recomputed from today's rate —
      // same reasoning as the mortality journals below: a disposal keeps the
      // FVLCTS rate in force the day it happened, so a later revaluation
      // cannot silently rewrite what this population's carrying amount was
      // when the animals left.
      this.prisma.livestockGroupDisposal.findMany({
        where: { groupId, journalEntryId: { not: null } },
        select: { carryingAmountKobo: true },
      }),
    ]);

    // Read what was actually posted, not what the current rate implies. Each
    // mortality journal debits the loss account at the FVLCTS rate in force
    // the day it happened — recomputing with today's rate would silently
    // rewrite history for any population that has since been revalued.
    const mortalityEntries = await this.prisma.journalEntry.findMany({
      where: { id: { in: mortalityJournals.map((m) => m.journalEntryId!) } },
      include: { lines: { where: { debitKobo: { gt: 0 } } } },
    });
    const mortalityLossKobo = mortalityEntries.reduce(
      (sum, entry) => sum + entry.lines.reduce((lineSum, line) => lineSum + line.debitKobo, 0n),
      0n,
    );
    const growthGainKobo = valuations.reduce(
      (sum, v) => sum + (v.direction === 'GAIN' ? v.gainLossKobo : -v.gainLossKobo),
      0n,
    );
    // Formula 6: quantity sold or transferred to processing x FVLCTS/unit.
    const disposalCarryingAmountKobo = disposals.reduce(
      (sum, d) => sum + d.carryingAmountKobo,
      0n,
    );

    /*
     * Harvested animals leave the asset when their processing order issues
     * them into WIP (at the rate in force then). Harvested but not yet
     * issued, they are still on the books at the current rate — and so is
     * the rearing cost set aside for them, which that issue will post.
     */
    const harvests = await this.prisma.harvestRecord.findMany({
      where: { companyId: group.companyId, groupId, destination: 'PROCESSING' },
      select: { id: true, count: true, productionOrder: { select: { issuedAt: true, biologicalInputValueKobo: true, rearingCostKobo: true } } },
    });
    const issued = harvests.filter((h) => h.productionOrder?.issuedAt);
    const processedKobo = issued.reduce((sum, h) => sum + h.productionOrder!.biologicalInputValueKobo, 0n);
    const awaitingProcessingKobo = harvests
      .filter((h) => !h.productionOrder?.issuedAt)
      .reduce((sum, h) => sum + BigInt(h.count ?? 0) * (group.currentFvlctsPerUnitKobo ?? 0n), 0n);

    /*
     * On the client's chart a flock's feed, medication and labour are
     * capitalised into the same account (RearingCostService), and relieved
     * from it when animals die, are sold or go to processing. Formula 7 as
     * first written left both out, so on SPEC a fed flock never reconciled.
     * A valuation's absorption of rearing cost (REVALUED) moves value inside
     * the account — the gain is already net of it — so it is not a movement.
     */
    const version = await chartVersionOf(this.prisma, group.companyId);
    const holdsRearing = holdsRearingInAssetOn(version, group.speciesKey);
    let rearingCapitalisedKobo = 0n;
    let rearingRelievedKobo = 0n;
    let rearingHeldKobo = 0n;
    if (holdsRearing) {
      const standing = { is: { reversedBy: { is: null } } };
      const [feed, treatments, labour, reliefs] = await Promise.all([
        this.prisma.feedIssue.aggregate({ where: { dailyRecord: { groupId }, journalEntry: standing }, _sum: { valueKobo: true } }),
        this.prisma.treatmentRecord.aggregate({ where: { companyId: group.companyId, groupId, journalEntry: standing }, _sum: { costKobo: true } }),
        this.prisma.farmCostAllocationLine.aggregate({ where: { groupId, speciesKey: 'poultry', allocation: { journalEntry: standing } }, _sum: { amountKobo: true } }),
        this.prisma.livestockRearingRelief.findMany({ where: { companyId: group.companyId, groupId }, select: { eventType: true, sourceId: true, amountKobo: true, journalEntryId: true } }),
      ]);
      const issuedHarvests = new Set(issued.map((h) => h.id));
      rearingCapitalisedKobo = (feed._sum.valueKobo ?? 0n) + (treatments._sum.costKobo ?? 0n) + (labour._sum.amountKobo ?? 0n);
      for (const relief of reliefs) {
        if (relief.eventType === 'TRANSFER_IN') rearingCapitalisedKobo += relief.amountKobo;
        else if (relief.eventType === 'HARVEST') {
          if (issuedHarvests.has(relief.sourceId)) rearingRelievedKobo += relief.amountKobo;
        } else if (relief.eventType !== 'REVALUED' && (relief.journalEntryId || relief.eventType === 'TRANSFER_OUT')) {
          rearingRelievedKobo += relief.amountKobo;
        }
      }
      rearingHeldKobo = await this.rearing.remaining(groupId);
    }

    // Hatchlings inherit the carrying amount of the viable eggs transferred
    // into their cohort. FVLCTS-recognized eggs have no historical acquisition
    // cost, so acquisitionCostKobo alone understated the cohort's opening BA
    // and made the stage roll-forward differ by the inherited egg value.
    const breedingTransfer = await this.prisma.snailBreedingCycle.findFirst({
      where: { companyId: group.companyId, hatchlingGroupId: group.id, status: 'HATCHED' },
      select: { hatchedCount: true, eggValuePerUnitKobo: true },
    });
    const transferredEggCarryingAmount = breedingTransfer
      ? BigInt(breedingTransfer.hatchedCount ?? 0) * breedingTransfer.eggValuePerUnitKobo
      : 0n;
    const openingBaKobo = group.acquisitionCostKobo + transferredEggCarryingAmount;
    const closingBaKobo = BigInt(group.population) * (group.currentFvlctsPerUnitKobo ?? 0n) + awaitingProcessingKobo + rearingHeldKobo;
    // Formula 7: Closing BA = Opening BA + rearing capitalised − mortality
    // loss − rearing relieved + growth/price gain − disposal carrying amount
    // − issued to processing.
    const expectedClosing =
      openingBaKobo + rearingCapitalisedKobo - mortalityLossKobo - rearingRelievedKobo + growthGainKobo - disposalCarryingAmountKobo - processedKobo;
    const differenceKobo = closingBaKobo - expectedClosing;

    return {
      groupCode: group.code,
      stage: group.stage,
      population: group.population,
      currentFvlctsPerUnitKobo: (group.currentFvlctsPerUnitKobo ?? 0n).toString(),
      openingBaKobo: openingBaKobo.toString(),
      rearingCapitalisedKobo: rearingCapitalisedKobo.toString(),
      mortalityLossKobo: mortalityLossKobo.toString(),
      rearingRelievedKobo: rearingRelievedKobo.toString(),
      growthGainKobo: growthGainKobo.toString(),
      disposalCarryingAmountKobo: disposalCarryingAmountKobo.toString(),
      processedKobo: processedKobo.toString(),
      awaitingProcessingKobo: awaitingProcessingKobo.toString(),
      rearingHeldKobo: rearingHeldKobo.toString(),
      closingBaKobo: closingBaKobo.toString(),
      differenceKobo: differenceKobo.toString(),
      reconciled: differenceKobo === 0n,
    };
  }
}
