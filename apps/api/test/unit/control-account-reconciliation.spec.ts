import { WorkflowStatus } from '@bioassetpro/database';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { ControlAccountReconciliationService } from '../../src/reporting/control-account-reconciliation.service';

function service({
  chartVersion = 'APPROVED',
  runs = [],
  assets = [],
  balances = {},
}: {
  chartVersion?: string;
  runs?: Array<Record<string, bigint>>;
  assets?: Array<{ costKobo: bigint; accumulatedDepreciationKobo: bigint }>;
  balances?: Record<string, bigint>;
} = {}) {
  const prisma = {
    company: { findUnique: vi.fn().mockResolvedValue({ chartVersion }) },
    salesInvoice: { findMany: vi.fn().mockResolvedValue([]) },
    supplierInvoice: { findMany: vi.fn().mockResolvedValue([]) },
    item: { findMany: vi.fn().mockResolvedValue([]) },
    productionOrder: { findMany: vi.fn().mockResolvedValue([]) },
    payrollRun: { findMany: vi.fn().mockResolvedValue(runs) },
    fixedAsset: { findMany: vi.fn().mockResolvedValue(assets) },
  } as unknown as PrismaService;
  const trialBalance = {
    build: vi.fn().mockResolvedValue({
      rows: Object.entries(balances).map(([accountNumber, netKobo]) => ({ accountNumber, netKobo })),
    }),
  } as unknown as TrialBalanceService;

  return {
    prisma,
    reconciliation: new ControlAccountReconciliationService(prisma, trialBalance),
  };
}

describe('control-account payroll reconciliation', () => {
  it('nets posted payroll payments against each liability bucket and combines buckets sharing a chart account', async () => {
    const { prisma, reconciliation } = service({
      runs: [{
        totalNetPayKobo: 1_000n,
        totalSalarySettledKobo: 200n,
        totalPayeKobo: 100n,
        totalPayeSettledKobo: 25n,
        totalEmployeePensionKobo: 50n,
        totalEmployerPensionKobo: 40n,
        totalPensionSettledKobo: 10n,
        totalNhfKobo: 20n,
        totalNhfSettledKobo: 0n,
        totalNsitfKobo: 30n,
        totalNsitfSettledKobo: 5n,
        totalItfKobo: 40n,
        totalItfSettledKobo: 0n,
      }],
      balances: { '20200': -65n, '20600': -75n, '20700': -900n },
    });

    const rows = await reconciliation.reconcile('company');

    expect(rows.filter((row) => ['20200', '20600', '20700'].includes(row.accountNumber))).toMatchObject([
      { accountNumber: '20200', subledgerKobo: '-65', varianceKobo: '0', reconciled: true },
      { accountNumber: '20600', subledgerKobo: '-75', varianceKobo: '0', reconciled: true },
      { accountNumber: '20700', subledgerKobo: '-900', varianceKobo: '0', reconciled: true },
    ]);
    expect(rows.find((row) => row.accountNumber === '20700')?.accountName).toBe(
      'Net salary payable / Pension payable / NHF payable',
    );
    expect(prisma.payrollRun.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        companyId: 'company',
        status: 'POSTED',
        journalEntry: { is: { reversedBy: { is: null } } },
      }),
    }));
  });

  it('surfaces payroll-liability balances with no posted payroll run behind them', async () => {
    const { reconciliation } = service({
      chartVersion: 'LEGACY',
      balances: { '2101': -500n },
    });

    const rows = await reconciliation.reconcile('company');

    expect(rows.find((row) => row.accountNumber === '2101')).toMatchObject({
      accountName: 'Net salary payable',
      glBalanceKobo: '-500',
      subledgerKobo: '0',
      varianceKobo: '-500',
      reconciled: false,
    });
  });

  it('reconciles posted, undisposed fixed-asset cost and accumulated depreciation', async () => {
    const { prisma, reconciliation } = service({
      assets: [
        { costKobo: 10_000n, accumulatedDepreciationKobo: 2_000n },
        { costKobo: 5_000n, accumulatedDepreciationKobo: 0n },
      ],
      balances: { '15200': 15_000n, '15600': -2_000n },
    });

    const rows = await reconciliation.reconcile('company');

    expect(rows.filter((row) => ['15200', '15600'].includes(row.accountNumber))).toMatchObject([
      { accountNumber: '15200', subledgerKobo: '15000', varianceKobo: '0', reconciled: true },
      { accountNumber: '15600', subledgerKobo: '-2000', varianceKobo: '0', reconciled: true },
    ]);
    expect(prisma.fixedAsset.findMany).toHaveBeenCalledWith({
      where: { companyId: 'company', status: WorkflowStatus.POSTED, disposedOn: null },
      select: { costKobo: true, accumulatedDepreciationKobo: true },
    });
  });

  it('reports fixed-asset balances left in the ledger when the register is empty', async () => {
    const { reconciliation } = service({
      chartVersion: 'LEGACY',
      balances: { '1701': 500n, '1702': -100n },
    });

    const rows = await reconciliation.reconcile('company');

    expect(rows.filter((row) => ['1701', '1702'].includes(row.accountNumber))).toMatchObject([
      { accountNumber: '1701', subledgerKobo: '0', varianceKobo: '500', reconciled: false },
      { accountNumber: '1702', subledgerKobo: '0', varianceKobo: '-100', reconciled: false },
    ]);
  });
});
