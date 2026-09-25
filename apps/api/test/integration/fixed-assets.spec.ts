import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { FixedAssetService } from '../../src/fixed-assets/fixed-asset.service';
import {
  DepreciationRunPostingHandler,
  FixedAssetCapitalisationPostingHandler,
  FixedAssetDisposalPostingHandler,
} from '../../src/fixed-assets/fixed-asset.handlers';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Fixed assets (UAT-007): capitalise, depreciate and dispose, each through
 * approval; the register, net book value and ledger agree; depreciation is
 * refused for an asset not yet in service, twice in a month, or on an asset
 * already disposed of.
 */

let prisma: PrismaService;
let assets: FixedAssetService;
let workflow: WorkflowService;
let fixture: TestFixture;
let maker: { userId: string; roles: string[] };
let approver: { userId: string; roles: string[] };

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  workflow = new WorkflowService(prisma, new WorkflowRoutingService(prisma), new DelegationService(prisma, audit), new NotificationService(prisma), audit);
  assets = new FixedAssetService(prisma, audit, posting, workflow);
  workflow.register(new FixedAssetCapitalisationPostingHandler(assets));
  workflow.register(new DepreciationRunPostingHandler(assets));
  workflow.register(new FixedAssetDisposalPostingHandler(assets));
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  maker = { userId: fixture.makerId, roles: ['FARM_ACCOUNTANT'] };
  approver = { userId: fixture.checkerId, roles: ['FARM_MANAGER'] };
  for (const [number, name, type, normal] of [
    ['1701', 'Property, Plant & Equipment', 'ASSET', 'DEBIT'],
    ['1702', 'Accumulated Depreciation', 'ASSET', 'CREDIT'],
    ['5501', 'Depreciation Expense', 'EXPENSE', 'DEBIT'],
    ['2201', 'Trade Payables', 'LIABILITY', 'CREDIT'],
  ] as const) {
    if (!fixture.accounts[number]) {
      fixture.accounts[number] = (
        await prisma.gLAccount.create({ data: { companyId: fixture.companyId, accountNumber: number, name, accountType: type, normalBalance: normal } })
      ).id;
    }
  }
  for (const type of ['FIXED_ASSET_CAPITALISATION', 'DEPRECIATION_RUN', 'FIXED_ASSET_DISPOSAL']) {
    await prisma.workflowDefinition.create({
      data: {
        companyId: fixture.companyId, transactionType: type, name: type, autoPostOnApproval: true, effectiveFrom: new Date('2026-01-01'),
        steps: { create: [{ level: 1, roleCode: 'FARM_MANAGER', name: 'Farm Manager', maxAmountKobo: null }] },
      },
    });
  }
});

async function balance(number: string) {
  const sums = await prisma.journalLine.aggregate({ where: { glAccountId: fixture.accounts[number]! }, _sum: { debitKobo: true, creditKobo: true } });
  return (sums._sum.debitKobo ?? 0n) - (sums._sum.creditKobo ?? 0n);
}

async function capitalise(name: string, acquired: string, costKobo: bigint, months: number) {
  const raised = await assets.capitalise({ companyId: fixture.companyId, actor: maker, name, assetClass: 'Machinery', acquisitionDate: new Date(acquired), costKobo, usefulLifeMonths: months });
  await workflow.approve({ transactionId: raised.awaitingApproval, actor: approver });
  return raised.assetId;
}

describe('Fixed assets (UAT-007)', () => {
  it('capitalises, depreciates and disposes through approval, and the register agrees with the ledger', async () => {
    const mixer = await capitalise('Feed mixer', '2026-01-05', 1_200_000_00n, 60); // ₦1.2m over 5 years: ₦20,000 a month
    expect(await balance('1701')).toBe(1_200_000_00n);

    const run = await assets.runDepreciation({ companyId: fixture.companyId, actor: maker, financialPeriodId: fixture.periodIds[0]! });
    await workflow.approve({ transactionId: run.awaitingApproval, actor: approver });
    expect(await balance('5501')).toBe(20_000_00n);
    expect(await balance('1702')).toBe(-20_000_00n);

    const register = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: mixer } });
    expect(register.accumulatedDepreciationKobo).toBe(20_000_00n);
    // Net book value in the register = cost less depreciation in the ledger.
    expect(register.costKobo - register.accumulatedDepreciationKobo).toBe((await balance('1701')) + (await balance('1702')));

    const disposal = await assets.dispose({ assetId: mixer, actor: maker, disposedOn: new Date('2026-02-10') });
    await workflow.approve({ transactionId: disposal.awaitingApproval, actor: approver });
    expect(await balance('1701')).toBe(0n);
    expect(await balance('1702')).toBe(0n);
    await expect(assets.dispose({ assetId: mixer, actor: maker, disposedOn: new Date('2026-02-11') })).rejects.toThrow(/already disposed/);
  });

  it('never depreciates an asset before it is in service, nor the same month twice', async () => {
    await capitalise('Feed mixer', '2026-01-05', 1_200_000_00n, 60);
    await capitalise('Generator', '2026-03-02', 600_000_00n, 60); // bought in March

    const january = await assets.runDepreciation({ companyId: fixture.companyId, actor: maker, financialPeriodId: fixture.periodIds[0]! });
    const entries = await prisma.depreciationEntry.findMany({ where: { runId: january.runId }, include: { asset: true } });
    expect(entries.map((e) => e.asset.name)).toEqual(['Feed mixer']); // not the generator
    await expect(
      assets.runDepreciation({ companyId: fixture.companyId, actor: maker, financialPeriodId: fixture.periodIds[0]! }),
    ).rejects.toThrow(/already exists for this period/);
  });
});
