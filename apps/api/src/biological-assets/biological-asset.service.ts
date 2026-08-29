import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ValuationDirection, WorkflowStatus } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../posting/posting.service';
import { WorkflowService } from '../workflow/workflow.service';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';
import type { WorkflowActor } from '../workflow/workflow.types';

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
@Injectable()
export class BiologicalAssetService {
  private readonly logger = new Logger(BiologicalAssetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
    private readonly workflow: WorkflowService,
  ) {}

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

    if (!row || !row.active) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §67 — Biological asset stage account',
        `No approved GL account is mapped for ${params.speciesKey} at stage "${params.stage}". ` +
          `The event is recorded; it stays unposted until an account is configured.`,
        { speciesKey: params.speciesKey, stage: params.stage },
      );
    }

    return {
      glAccountId: row.glAccountId,
      accountNumber: row.glAccount.accountNumber,
      accountName: row.glAccount.name,
    };
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
    const account = await this.prisma.gLAccount.findFirst({
      where: { companyId, accountNumber: '210200', active: true },
      select: { id: true },
    });
    if (!account) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §66 — Posting chart',
        'No active GRNI account (210200) exists. A biological receipt cannot post without one.',
        { accountNumber: '210200' },
      );
    }
    return { glAccountId: account.id };
  }

  private async fairValueAccount(
    companyId: string,
    speciesKey: string,
  ): Promise<{ glAccountId: string }> {
    // 420100 Snails, 420200 Poultry — the same numbering pattern the workbook
    // uses throughout (species offset by 100).
    const accountNumber = speciesKey === 'snail' ? '420100' : '420200';
    const account = await this.prisma.gLAccount.findFirst({
      where: { companyId, accountNumber, active: true },
      select: { id: true },
    });
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
    const accountNumber = speciesKey === 'snail' ? '640300' : '640500';
    const account = await this.prisma.gLAccount.findFirst({
      where: { companyId, accountNumber, active: true },
      select: { id: true },
    });
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
  private async postingContext(companyId: string, on: Date) {
    const [period, costCentre, company] = await Promise.all([
      this.prisma.financialPeriod.findFirst({
        where: { financialYear: { companyId }, startDate: { lte: on }, endDate: { gte: on }, status: 'OPEN' },
        select: { id: true, financialYearId: true },
      }),
      this.prisma.costCentre.findFirst({
        where: { companyId, active: true },
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

      const stage = await this.stageAccount({
        companyId: group.companyId,
        speciesKey: group.speciesKey,
        stage: group.stage,
      });
      const debitAccount = abnormal
        ? await this.abnormalLossAccount(group.companyId, group.speciesKey)
        : await this.fairValueAccount(group.companyId, group.speciesKey);
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
        narration: `${mortality.quantity} ${abnormal ? 'abnormal' : 'normal'} deaths — ${group.code}`,
        ...dimensions,
        lines: [
          {
            glAccountId: debitAccount.glAccountId,
            description: `${abnormal ? 'Abnormal' : 'Normal'} mortality — ${group.code}`,
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
          classification: abnormal ? 'ABNORMAL' : 'NORMAL',
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
    const accountNumber = speciesKey === 'snail' ? '510100' : '510300';
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
  /* Valuation — PCR-046/047/070/071, maker-checker via WorkflowService  */
  /* ------------------------------------------------------------------ */

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

    const priorFvlcts = group.currentFvlctsPerUnitKobo ?? 0n;
    const currentFvlcts = params.marketPricePerUnitKobo - params.costsToSellPerUnitKobo;
    // Formula 4: closing quantity × (current − prior). Population is the
    // closing quantity — nothing has moved between raising this and reading it.
    const gainLossKobo = BigInt(group.population) * (currentFvlcts - priorFvlcts);
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

    const result = await this.posting.post(
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
      data: { currentFvlctsPerUnitKobo: valuation.currentFvlctsPerUnitKobo },
    });

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

    const openingBaKobo = group.acquisitionCostKobo;
    const closingBaKobo = BigInt(group.population) * (group.currentFvlctsPerUnitKobo ?? 0n);
    // Formula 7: Closing BA = Opening BA - mortality loss + growth/price gain
    // - disposal carrying amount.
    const expectedClosing = openingBaKobo - mortalityLossKobo + growthGainKobo - disposalCarryingAmountKobo;
    const differenceKobo = closingBaKobo - expectedClosing;

    return {
      groupCode: group.code,
      stage: group.stage,
      population: group.population,
      currentFvlctsPerUnitKobo: (group.currentFvlctsPerUnitKobo ?? 0n).toString(),
      openingBaKobo: openingBaKobo.toString(),
      mortalityLossKobo: mortalityLossKobo.toString(),
      growthGainKobo: growthGainKobo.toString(),
      disposalCarryingAmountKobo: disposalCarryingAmountKobo.toString(),
      closingBaKobo: closingBaKobo.toString(),
      differenceKobo: differenceKobo.toString(),
      reconciled: differenceKobo === 0n,
    };
  }
}
