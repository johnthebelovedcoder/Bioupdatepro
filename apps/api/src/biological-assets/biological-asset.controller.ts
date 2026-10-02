import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BiologicalAssetService } from './biological-asset.service';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { OwnedRecord } from '../auth/owned-record.guard';
import { AnyRole, Roles } from '../auth/roles.guard';
import { AccountingRuleViolation } from '../common/errors';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * The biological-asset ledger over HTTP.
 *
 * Reading is open to anyone signed in — a supervisor deciding whether a
 * colony is ready needs to see its carrying value as much as a controller
 * does. Raising a valuation and approving one are both role-gated, because
 * §61.6 names who may do each.
 */
@Controller('biological-assets')
export class BiologicalAssetController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: BiologicalAssetService,
  ) {}

  @AnyRole('Every population and its carrying value.')
  @Get('groups')
  async groups(@CurrentCompany() companyId: string) {
    const rows = await this.prisma.livestockGroup.findMany({
      where: { companyId, status: 'ACTIVE' },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        speciesKey: true,
        breed: true,
        stage: true,
        population: true,
        currentFvlctsPerUnitKobo: true,
        acquisitionCostKobo: true,
        measurementBasis: true,
        fairValueUnreliableReason: true,
        fairValueReliabilityReviewedOn: true,
        fairValueReliabilityEvidence: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      speciesKey: row.speciesKey,
      breed: row.breed,
      stage: row.stage,
      population: row.population,
      currentFvlctsPerUnitKobo: row.currentFvlctsPerUnitKobo?.toString() ?? null,
      carryingValueKobo:
        row.currentFvlctsPerUnitKobo !== null
          ? (BigInt(row.population) * row.currentFvlctsPerUnitKobo).toString()
          : null,
      acquisitionCostKobo: row.acquisitionCostKobo.toString(),
      acquisitionPosted: row.currentFvlctsPerUnitKobo !== null,
      measurementBasis: row.measurementBasis,
      fairValueUnreliableReason: row.fairValueUnreliableReason,
      fairValueReliabilityReviewedOn: row.fairValueReliabilityReviewedOn?.toISOString().slice(0, 10) ?? null,
      fairValueReliabilityEvidence: row.fairValueReliabilityEvidence,
    }));
  }

  @OwnedRecord('livestockGroup', 'id')
  @AnyRole('The §61.3 roll-forward for one population.')
  @Get('groups/:id/roll-forward')
  async rollForward(@Param('id') id: string) {
    return this.assets.rollForward(id);
  }

  /** Monthly reporting-date valuation queue, including groups with no posted valuation yet. */
  @AnyRole('Groups needing a reporting-date or pre-harvest biological-asset valuation.')
  @Get('valuation-due')
  async valuationDue(@CurrentCompany() companyId: string, @Query('asOf') asOf?: string) {
    const date = asOf ? new Date(asOf) : new Date();
    if (Number.isNaN(date.getTime())) throw new AccountingRuleViolation('IAS 41 — Valuation schedule', 'Use a valid reporting date.', {});
    date.setUTCHours(0, 0, 0, 0);
    const [groups, valuations] = await Promise.all([
      this.prisma.livestockGroup.findMany({
        where: { companyId, status: 'ACTIVE', startedOn: { lte: date } },
        orderBy: { expectedHarvestDate: 'asc' },
        select: { id: true, code: true, speciesKey: true, breed: true, stage: true, population: true, startedOn: true, expectedHarvestDate: true, currentFvlctsPerUnitKobo: true, measurementBasis: true, fairValueReliabilityReviewedOn: true },
      }),
      this.prisma.biologicalAssetValuation.findMany({
        where: { companyId, status: 'POSTED', valuationDate: { lte: date } },
        orderBy: { valuationDate: 'desc' },
        select: { groupId: true, valuationDate: true },
      }),
    ]);
    const latest = new Map<string, Date>();
    for (const valuation of valuations) if (!latest.has(valuation.groupId)) latest.set(valuation.groupId, valuation.valuationDate);
    const preHarvestWindow = new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
    return groups.map((group) => {
      const lastValuationDate = latest.get(group.id) ?? null;
      const monthlyDue = group.measurementBasis === 'ATTRIBUTABLE_COST'
        ? !group.fairValueReliabilityReviewedOn || group.fairValueReliabilityReviewedOn.getTime() !== date.getTime()
        : !lastValuationDate || lastValuationDate < date;
      const preHarvestDue = !!group.expectedHarvestDate && group.expectedHarvestDate >= date && group.expectedHarvestDate <= preHarvestWindow;
      return {
        id: group.id,
        code: group.code,
        speciesKey: group.speciesKey,
        breed: group.breed,
        stage: group.stage,
        population: group.population,
        measurementBasis: group.measurementBasis,
        fairValueReliabilityReviewedOn: group.fairValueReliabilityReviewedOn?.toISOString().slice(0, 10) ?? null,
        lastValuationDate,
        currentFvlctsPerUnitKobo: group.currentFvlctsPerUnitKobo?.toString() ?? null,
        unvalued: group.currentFvlctsPerUnitKobo === null,
        monthlyDue,
        preHarvestDue,
        due: monthlyDue || preHarvestDue,
      };
    }).filter((row) => row.due || row.unvalued);
  }

  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('groups/:id/fair-value-reliability-review')
  async reviewFairValueReliability(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') groupId: string,
    @Body() body: { reviewedOn: string; stillUnreliable: boolean; reason: string; evidenceReference: string },
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body?.reviewedOn ?? '') || Number.isNaN(new Date(`${body.reviewedOn}T00:00:00.000Z`).getTime())) {
      throw new AccountingRuleViolation('IAS 41 — Cost exception reliability review', 'Use a valid review date in YYYY-MM-DD format.', {});
    }
    return this.assets.reviewFairValueReliability({
      companyId,
      groupId,
      reviewedOn: new Date(`${body.reviewedOn}T00:00:00.000Z`),
      stillUnreliable: body.stillUnreliable === true,
      reason: body.reason,
      evidenceReference: body.evidenceReference,
      actor,
    });
  }

  /*
   * Acquisition posts once, the moment a population is placed
   * (OperationsService.recordNewGroup) — there was no way to ask for it
   * again. That left a population whose acquisition failed only because an
   * account was missing (the exact gap `BiologicalAssetService` now
   * self-heals) unposted forever: the account gets created the NEXT time
   * anything for that species/stage tries to post, never for the group
   * that already hit the gap. Same roles as raising the placement itself.
   */
  @OwnedRecord('livestockGroup', 'id')
  @Roles('FARM_MANAGER', 'CFO')
  @Post('groups/:id/retry-posting')
  async retryPosting(@Param('id') id: string, @CurrentUser() actor: WorkflowActor) {
    return this.assets.postAcquisition({ groupId: id, actor });
  }

  @AnyRole('The valuations raised, and where each stands.')
  @Get('valuations')
  async valuations(@CurrentCompany() companyId: string) {
    const rows = await this.prisma.biologicalAssetValuation.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { group: { select: { code: true } }, preparedBy: { select: { fullName: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      groupCode: row.group.code,
      stage: row.stage,
      valuationDate: row.valuationDate,
      closingQuantity: row.closingQuantity,
      priorFvlctsPerUnitKobo: row.priorFvlctsPerUnitKobo.toString(),
      currentFvlctsPerUnitKobo: row.currentFvlctsPerUnitKobo.toString(),
      direction: row.direction,
      gainLossKobo: row.gainLossKobo.toString(),
      evidenceReference: row.evidenceReference,
      status: row.status,
      preparedBy: row.preparedBy.fullName,
      journalEntryId: row.journalEntryId,
    }));
  }

  /**
   * §61.6: "Farm Accountant / Finance Controller."
   *
   * FARM_ACCOUNTANT (ROL-012) now exists — the RACI sheet's actual preparer,
   * "Reconcile BA, inventory, WIP, journals and valuations." FINANCE_MANAGER
   * and FINANCE_CONTROLLER are kept too: RACI marks Finance Manager/Head as
   * the APPROVER of valuations, but a smaller farm without a separate Farm
   * Accountant still needs someone able to raise one. Approval itself is a
   * separate step through the workflow engine below, so this list being wide
   * does not weaken maker-checker.
   */
  @Roles('FARM_ACCOUNTANT', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('valuations')
  async requestValuation(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      groupId: string;
      valuationDate: string;
      marketPricePerUnitKobo: string;
      costsToSellPerUnitKobo: string;
      evidenceReference: string;
    },
  ) {
    if (!body.evidenceReference?.trim()) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §61.6 — Valuation evidence',
        'Approved market evidence is required before a valuation can be raised.',
        {},
      );
    }
    const result = await this.assets.requestValuation({
      companyId,
      groupId: body.groupId,
      valuationDate: new Date(body.valuationDate),
      marketPricePerUnitKobo: BigInt(body.marketPricePerUnitKobo || '0'),
      costsToSellPerUnitKobo: BigInt(body.costsToSellPerUnitKobo || '0'),
      evidenceReference: body.evidenceReference.trim(),
      actor,
    });
    return result;
  }

  /*
   * Approval itself goes through /workflow/:transactionId/approve, the same
   * route every other document uses — a valuation is a WorkflowTransaction
   * like a purchase order or a goods receipt, and giving it a second approval
   * endpoint would be the duplicate maker-checker mechanism Rule 2 forbids.
   */

  /**
   * The governed market price list (US-897-011) — what the valuation form
   * prefills from.
   */
  @AnyRole('The valuation form prefills its price fields from this.')
  @Get('market-prices')
  async marketPrices(@CurrentCompany() companyId: string) {
    const rows = await this.assets.listCurrentMarketPrices(companyId);
    return rows.map((row) => ({
      speciesKey: row.speciesKey,
      breed: row.breed,
      marketPricePerUnitKobo: row.marketPricePerUnitKobo.toString(),
      costsToSellPerUnitKobo: row.costsToSellPerUnitKobo.toString(),
      evidenceReference: row.evidenceReference,
      effectiveFrom: row.effectiveFrom,
    }));
  }

  @Roles('FARM_ACCOUNTANT', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('market-prices')
  async setMarketPrice(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      speciesKey: string;
      breed: string;
      marketPricePerUnitKobo: string;
      costsToSellPerUnitKobo?: string;
      evidenceReference: string;
      effectiveFrom: string;
    },
  ) {
    const created = await this.assets.setMarketPrice({
      companyId,
      actor,
      speciesKey: body.speciesKey,
      breed: body.breed,
      marketPricePerUnitKobo: BigInt(body.marketPricePerUnitKobo || '0'),
      costsToSellPerUnitKobo: BigInt(body.costsToSellPerUnitKobo || '0'),
      evidenceReference: body.evidenceReference,
      effectiveFrom: new Date(body.effectiveFrom),
    });
    return {
      id: created.id,
      speciesKey: created.speciesKey,
      breed: created.breed,
      marketPricePerUnitKobo: created.marketPricePerUnitKobo.toString(),
      costsToSellPerUnitKobo: created.costsToSellPerUnitKobo.toString(),
      effectiveFrom: created.effectiveFrom,
    };
  }
}
