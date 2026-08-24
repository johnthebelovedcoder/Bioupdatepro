import { Body, Controller, Get, Param, Post } from '@nestjs/common';
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
    }));
  }

  @OwnedRecord('livestockGroup', 'id')
  @AnyRole('The §61.3 roll-forward for one population.')
  @Get('groups/:id/roll-forward')
  async rollForward(@Param('id') id: string) {
    return this.assets.rollForward(id);
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
   * §61.6: "Farm Accountant / Financial Controller." This codebase has no
   * Farm Accountant role — the six seeded roles are Administrator, Managing
   * Director, Farm Manager, Finance Manager, Financial Controller and
   * Production Supervisor. Finance Manager is used as the nearest analogue for
   * "prepares the figures"; stated here rather than left implicit.
   */
  @Roles('FINANCE_MANAGER', 'FINANCIAL_CONTROLLER', 'MANAGING_DIRECTOR')
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
}
