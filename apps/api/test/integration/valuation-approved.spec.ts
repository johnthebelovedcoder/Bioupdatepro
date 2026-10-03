import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { RearingCostService } from '../../src/biological-assets/rearing-cost.service';
import { BiologicalAssetService } from '../../src/biological-assets/biological-asset.service';
import { WorkflowService } from '../../src/workflow/workflow.service';
import { WorkflowRoutingService } from '../../src/workflow/workflow-routing.service';
import { DelegationService } from '../../src/workflow/delegation.service';
import { NotificationService } from '../../src/workflow/notification.service';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { ProfitLossService } from '../../src/reporting/profit-loss.service';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Valuation and mortality results on the approved five-digit chart: a gain
 * credits 42000 and a loss debits 42100 (separate accounts, from the
 * workbook's BA_FAIR_VALUE_GAIN / BA_FAIR_VALUE_LOSS), normal deaths debit
 * 51010 (snail) / 51020 (poultry), abnormal deaths 51110 / 51120, and a
 * bought flock is credited to GRNI 20300. Snail stages are carried in 16031
 * (immature) and 16041 (mature) like poultry in 16032 / 16042.
 */

let prisma: PrismaService;
let assets: BiologicalAssetService;
let profitLoss: ProfitLossService;
let fixture: TestFixture;
let cfo: { userId: string; roles: string[] };
const gl = new Map<string, string>();
const ON = new Date('2026-01-10');

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  const rearing = new RearingCostService(prisma, posting);
  const workflow = new WorkflowService(prisma, new WorkflowRoutingService(prisma), new DelegationService(prisma, audit), new NotificationService(prisma), audit);
  assets = new BiologicalAssetService(prisma, posting, workflow, audit, rearing);
  profitLoss = new ProfitLossService(new TrialBalanceService(prisma));
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  cfo = { userId: fixture.makerId, roles: ['CFO'] };
  await prisma.company.update({ where: { id: fixture.companyId }, data: { chartVersion: 'APPROVED' } });

  const accounts: Array<[string, string, 'ASSET' | 'EXPENSE' | 'REVENUE' | 'LIABILITY', 'DEBIT' | 'CREDIT', boolean]> = [
    ['16031', 'Snail biological assets - immature', 'ASSET', 'DEBIT', true],
    ['16032', 'Poultry biological assets - immature', 'ASSET', 'DEBIT', true],
    ['16041', 'Snail biological assets - mature', 'ASSET', 'DEBIT', true],
    ['16042', 'Poultry biological assets - mature', 'ASSET', 'DEBIT', true],
    ['42000', 'Fair value gain on biological assets', 'REVENUE', 'CREDIT', false],
    ['42100', 'Fair value loss on biological assets', 'EXPENSE', 'DEBIT', false],
    ['51010', 'Normal snail mortality loss', 'EXPENSE', 'DEBIT', false],
    ['51020', 'Normal poultry mortality loss', 'EXPENSE', 'DEBIT', false],
    ['51110', 'Abnormal snail mortality loss', 'EXPENSE', 'DEBIT', false],
    ['51120', 'Abnormal poultry mortality loss', 'EXPENSE', 'DEBIT', false],
    ['20300', 'Goods received not invoiced', 'LIABILITY', 'CREDIT', true],
  ];
  gl.clear();
  for (const [accountNumber, name, accountType, normalBalance, control] of accounts) {
    gl.set(accountNumber, (await prisma.gLAccount.create({
      data: { companyId: fixture.companyId, accountNumber, name, accountType, normalBalance, isControlAccount: control, isPostingAccount: !control },
    })).id);
  }
  await prisma.workflowDefinition.create({
    data: {
      companyId: fixture.companyId, transactionType: 'BA_VALUATION', name: 'Valuation route', effectiveFrom: new Date('2026-01-01'),
      steps: { create: [{ level: 1, roleCode: 'CFO', name: 'CFO', maxAmountKobo: null }] },
    },
  });
});

async function population(code: string, speciesKey: 'poultry' | 'snail', stage: string, animals: number, extra: { acquisitionCostKobo?: bigint } = {}) {
  const pen = await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: `PEN-${code}`, name: code } });
  return prisma.livestockGroup.create({
    data: {
      companyId: fixture.companyId, branchId: fixture.branchId, farmId: fixture.farmId, penHouseId: pen.id, code, speciesKey,
      breed: 'Test', purpose: 'Growers', stage, openingPopulation: animals, population: animals, startedOn: new Date('2026-01-01'), ...extra,
    },
  });
}

async function balance(accountNumber: string) {
  const sums = await prisma.journalLine.aggregate({ where: { glAccountId: gl.get(accountNumber)! }, _sum: { debitKobo: true, creditKobo: true } });
  return (sums._sum.debitKobo ?? 0n) - (sums._sum.creditKobo ?? 0n);
}

async function value(groupId: string, pricePerBirdKobo: bigint, on = ON) {
  const { id } = await assets.requestValuation({
    companyId: fixture.companyId, groupId, valuationDate: on, marketPricePerUnitKobo: pricePerBirdKobo,
    costsToSellPerUnitKobo: 0n, evidenceReference: 'Market survey', actor: cfo,
  });
  await prisma.$transaction((tx) => assets.postApprovedValuation({ valuationId: id, actor: cfo, tx }));
  return prisma.biologicalAssetValuation.findUniqueOrThrow({ where: { id } });
}

describe('valuation and mortality results on the approved chart', () => {
  it('credits a gain to 42000 and debits a loss to 42100, each against the stage account', async () => {
    const flock = await population('L-1', 'poultry', 'Grower', 100);
    expect(await value(flock.id, 100_000n)).toMatchObject({ direction: 'GAIN', gainLossKobo: 10_000_000n });
    expect(await balance('42000')).toBe(-10_000_000n);
    expect(await balance('16032')).toBe(10_000_000n);

    expect(await value(flock.id, 80_000n, new Date('2026-01-20'))).toMatchObject({ direction: 'LOSS', gainLossKobo: 2_000_000n });
    expect(await balance('42100')).toBe(2_000_000n);
    expect(await balance('42000')).toBe(-10_000_000n); // the gain stands; the loss is its own account
    expect(await balance('16032')).toBe(8_000_000n);
  });

  it('presents a fair value loss against other income, not among the operating costs', async () => {
    const flock = await population('L-2', 'poultry', 'Grower', 100);
    await value(flock.id, 100_000n);
    await value(flock.id, 80_000n, new Date('2026-01-20'));
    const result = await profitLoss.build({ companyId: fixture.companyId, financialYearId: fixture.financialYearId });
    expect(result.otherIncomeKobo).toBe('8000000'); // ₦100,000 gain less ₦20,000 loss
    expect(result.operatingExpenseKobo).toBe('0');
    expect(result.profitBeforeTaxKobo).toBe('8000000');
    expect(result.otherIncomeLines.map((l) => [l.accountNumber, l.amountKobo]).sort()).toEqual([
      ['42000', '10000000'],
      ['42100', '-2000000'],
    ]);
  });

  it('carries a snail in 16031 while immature and 16041 once mature', async () => {
    const grower = await population('S-1', 'snail', 'Grower', 100);
    const ready = await population('S-2', 'snail', 'Market-ready', 100);
    await value(grower.id, 50_000n);
    await value(ready.id, 70_000n);
    expect(await balance('16031')).toBe(5_000_000n);
    expect(await balance('16041')).toBe(7_000_000n);
    expect(await balance('42000')).toBe(-12_000_000n);
  });

  it('writes normal deaths to the species’ normal mortality account', async () => {
    for (const [species, code, normal] of [['poultry', 'L-3', '51020'], ['snail', 'S-3', '51010']] as const) {
      const group = await population(code, species, 'Grower', 100);
      await value(group.id, 100_000n);
      const record = await prisma.dailyRecord.create({ data: { companyId: fixture.companyId, groupId: group.id, recordedOn: new Date('2026-01-15'), recordedById: fixture.makerId } });
      const mortality = await prisma.mortalityRecord.create({ data: { dailyRecordId: record.id, quantity: 1, causes: ['Disease'] } });
      await prisma.livestockGroup.update({ where: { id: group.id }, data: { population: 99 } });
      expect(await assets.postMortality({ mortalityRecordId: mortality.id, actor: cfo })).toMatchObject({ posted: true });
      expect(await balance(normal)).toBe(100_000n);
    }
  });

  it('writes an approved abnormal claim to the species’ abnormal mortality account', async () => {
    for (const [species, code, abnormal] of [['poultry', 'L-4', '51120'], ['snail', 'S-4', '51110']] as const) {
      const group = await population(code, species, 'Grower', 100);
      await value(group.id, 100_000n);
      const record = await prisma.dailyRecord.create({ data: { companyId: fixture.companyId, groupId: group.id, recordedOn: new Date('2026-01-15'), recordedById: fixture.makerId } });
      const mortality = await prisma.mortalityRecord.create({ data: { dailyRecordId: record.id, quantity: 5, causes: ['Heat'] } });
      await prisma.$transaction((tx) => assets.postApprovedAbnormalMortality({ mortalityRecordId: mortality.id, actor: cfo, tx }));
      expect(await balance(abnormal)).toBe(500_000n);
    }
  });

  it('credits a bought flock to GRNI 20300 against its stage account', async () => {
    const flock = await population('L-5', 'poultry', 'Chick', 100, { acquisitionCostKobo: 4_000_000n });
    expect(await assets.postAcquisition({ groupId: flock.id, actor: cfo })).toMatchObject({ posted: true });
    expect(await balance('16032')).toBe(4_000_000n);
    expect(await balance('20300')).toBe(-4_000_000n);
  });
});
