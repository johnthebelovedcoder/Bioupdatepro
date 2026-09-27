import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { WorkflowService } from '../../src/workflow/workflow.service';
import { WorkflowRoutingService } from '../../src/workflow/workflow-routing.service';
import { DelegationService } from '../../src/workflow/delegation.service';
import { NotificationService } from '../../src/workflow/notification.service';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { ProfitLossService } from '../../src/reporting/profit-loss.service';
import { StockMovementService } from '../../src/inventory/stock-movement.service';
import { KpiService } from '../../src/reporting/kpi.service';
import { kobo } from '../../src/common/money';
import { dims, resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';
import { kpiService, kpisByKey } from '../helpers/kpis';

/**
 * KPI-02 current ratio and KPI-04 inventory days on the KPIs page
 * (REPORT_KPI_CHECKS); the case replays cover yield, hatch rate, mortality
 * and close readiness on the workbook's own cases.
 */

let prisma: PrismaService;
let posting: PostingService;
let kpis: KpiService;
let fixture: TestFixture;

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  const workflow = new WorkflowService(prisma, new WorkflowRoutingService(prisma), new DelegationService(prisma, audit), new NotificationService(prisma), audit);
  kpis = kpiService(prisma, posting, workflow, new ProfitLossService(new TrialBalanceService(prisma)));
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
});

/** Posts in the period covering today, so the "this year" KPIs see it. */
async function journal(ref: string, lines: Array<[string, 'debit' | 'credit', bigint]>) {
  const today = new Date();
  const index = fixture.periodIds.findIndex((_, i) => i === today.getUTCMonth());
  const d = dims(fixture, index < 0 ? 0 : index);
  await posting.post({
    sourceModule: 'test', sourceDocumentType: 'Document', journalNumber: ref, journalDate: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
    narration: ref, ...d, idempotencyKey: `kpis:${ref}`, actor: { userId: fixture.makerId, roles: ['CFO'] },
    lines: lines.map(([account, side, amount]) => ({ glAccountId: fixture.accounts[account]!, description: ref, [side]: kobo(amount), dimensions: d })),
  });
}

describe('KPIs: current ratio and inventory days (KPI-02, KPI-04)', () => {
  it('works out the current ratio once every account holding a balance is classified, and says which are not', async () => {
    // KPI_FORMULA_DEMOS KPI-02: ₦5,000,000 current assets, ₦2,500,000 current liabilities.
    await journal('CR-1', [['1101', 'debit', 500_000_000n], ['2130', 'credit', 250_000_000n], ['4101', 'credit', 250_000_000n]]);
    expect((await kpisByKey(kpis, fixture.companyId)).currentRatio).toMatchObject({ computable: false, reason: expect.stringMatching(/2 asset or liability accounts with a balance have no statement category/) });

    await prisma.gLAccount.update({ where: { id: fixture.accounts['1101']! }, data: { fsCategory: 'CURRENT_ASSET' } });
    await prisma.gLAccount.update({ where: { id: fixture.accounts['2130']! }, data: { fsCategory: 'CURRENT_LIABILITY' } });
    expect((await kpisByKey(kpis, fixture.companyId)).currentRatio).toMatchObject({ computable: true, value: '2.00', format: 'times' });
  });

  it('works out inventory days from the stock on hand and the year’s cost of sales', async () => {
    const cogs = await prisma.gLAccount.create({ data: { companyId: fixture.companyId, accountNumber: '5001', name: 'Cost of sales', accountType: 'EXPENSE', normalBalance: 'DEBIT' } });
    fixture.accounts['5001'] = cogs.id;
    expect((await kpisByKey(kpis, fixture.companyId)).inventoryDays!.computable).toBe(false);

    // KPI-04's inputs: ₦1,800,000 of stock, ₦4,283,333 cost of sales.
    const uom = await prisma.unitOfMeasure.create({ data: { companyId: fixture.companyId, code: 'KG', name: 'Kilogram' } });
    const store = await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'RAW', name: 'Raw', type: 'RAW_MATERIAL' } });
    const item = await prisma.item.create({ data: { companyId: fixture.companyId, code: 'FEED', description: 'Feed', unitOfMeasureId: uom.id, inventoryGlAccountId: fixture.accounts['1301']! } });
    await prisma.$transaction((tx) =>
      new StockMovementService(prisma).receiveIn({
        tx, companyId: fixture.companyId, branchId: fixture.branchId, itemId: item.id, warehouseId: store.id, quantity: new Decimal(1_000), valueKobo: 180_000_000n,
        sourceModule: 'test', sourceDocumentType: 'Receipt', sourceDocumentId: 'grn', documentReference: 'GRN', movementDate: new Date(),
      }),
    );
    await journal('COGS-1', [['5001', 'debit', 428_333_300n], ['1101', 'credit', 428_333_300n]]);

    const year = await prisma.financialYear.findUniqueOrThrow({ where: { id: fixture.financialYearId } });
    const elapsed = Math.max(1, Math.floor((Date.now() - year.startDate.getTime()) / 86_400_000));
    const expected = new Decimal(1_800_000).div(4_283_333).mul(elapsed).toFixed(1);
    expect((await kpisByKey(kpis, fixture.companyId)).inventoryDays).toMatchObject({ computable: true, value: expected, format: 'days' });
  });
});
