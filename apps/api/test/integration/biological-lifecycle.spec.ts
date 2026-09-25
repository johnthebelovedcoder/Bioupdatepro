import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { RearingCostService } from '../../src/biological-assets/rearing-cost.service';
import { StockMovementService } from '../../src/inventory/stock-movement.service';
import { OperationsPostingService } from '../../src/operations/operations-posting.service';
import { BiologicalAssetService } from '../../src/biological-assets/biological-asset.service';
import { OperationsService } from '../../src/operations/operations.service';
import { BatchProfileService } from '../../src/operations/batch-profile.service';
import { WorkflowService } from '../../src/workflow/workflow.service';
import { WorkflowRoutingService } from '../../src/workflow/workflow-routing.service';
import { DelegationService } from '../../src/workflow/delegation.service';
import { NotificationService } from '../../src/workflow/notification.service';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * The biological lifecycle's controls, end to end through the real services:
 * stage by age (UAT-012), deaths and abnormal loss (UAT-013 / UAT-017),
 * valuation (UAT-014), one round per batch per day (UAT-019).
 */

let prisma: PrismaService;
let assets: BiologicalAssetService;
let operations: OperationsService;
let fixture: TestFixture;
let clerk: { userId: string; roles: string[] };

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  const rearing = new RearingCostService(prisma, posting);
  const workflow = new WorkflowService(prisma, new WorkflowRoutingService(prisma), new DelegationService(prisma, audit), new NotificationService(prisma), audit);
  assets = new BiologicalAssetService(prisma, posting, workflow, audit, rearing);
  operations = new OperationsService(
    prisma, new IdempotencyService(prisma), audit,
    new OperationsPostingService(prisma, posting, rearing, new StockMovementService(prisma)),
    assets, new BatchProfileService(prisma, audit),
  );
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  clerk = { userId: fixture.makerId, roles: ['FARM_ATTENDANT'] };
  for (const type of ['BIOLOGICAL_ASSET_ABNORMAL_MORTALITY', 'BA_VALUATION']) {
    await prisma.workflowDefinition.create({
      data: {
        companyId: fixture.companyId, transactionType: type, name: type, effectiveFrom: new Date('2026-01-01'),
        steps: { create: [{ level: 1, roleCode: 'FARM_MANAGER', name: 'Farm Manager', maxAmountKobo: null }] },
      },
    });
  }
  // Ross 308 thresholds (POULTRY_BREED_MASTER).
  await prisma.speciesBreed.create({
    data: {
      companyId: fixture.companyId, speciesKey: 'poultry', code: 'BR-BROIL-01', name: 'Ross 308', openingStage: 'Chick',
      stages: { create: [
        { stageName: 'Chick', minDay: 0, sortOrder: 1 },
        { stageName: 'Grower', minDay: 15, sortOrder: 2 },
        { stageName: 'Market-ready', minDay: 42, sortOrder: 3 },
      ] },
    },
  });
  const pen = await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: 'H1', name: 'House 1' } });
  await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: 'H2', name: 'House 2' } });
  await prisma.livestockGroup.create({
    data: {
      companyId: fixture.companyId, branchId: fixture.branchId, farmId: fixture.farmId, penHouseId: pen.id, code: 'FLK-1', speciesKey: 'poultry',
      breed: 'Ross 308', purpose: 'Broiler', stage: 'Chick', openingPopulation: 500, population: 500, startedOn: new Date('2026-01-01'),
      currentFvlctsPerUnitKobo: 100_000n, // ₦1,000 a bird, as last valued
    },
  });
});

const round = (date: string, entry: Record<string, unknown>, key = `round-${date}`) =>
  operations.recordRound({ companyId: fixture.companyId, actor: clerk, idempotencyKey: key, payload: { module: 'poultry', date, entries: [{ groupCode: 'FLK-1', ...entry }] } });

describe('Stage by age (UAT-012)', () => {
  it('moves a batch to a stage its age has reached', async () => {
    await operations.recordStageChange({
      companyId: fixture.companyId, actor: clerk, idempotencyKey: 'move-ok',
      payload: { groupCode: 'FLK-1', date: '2026-01-20', fromStage: 'Chick', toStage: 'Grower', fromHouse: 'H1', toHouse: 'H2' },
    });
    expect((await prisma.livestockGroup.findFirstOrThrow({ where: { code: 'FLK-1' } })).stage).toBe('Grower');
  });

  it('refuses a stage the batch is too young for, saying its age and what the stage needs', async () => {
    await expect(
      operations.recordStageChange({
        companyId: fixture.companyId, actor: clerk, idempotencyKey: 'move-early',
        payload: { groupCode: 'FLK-1', date: '2026-01-20', fromStage: 'Chick', toStage: 'Market-ready', fromHouse: 'H1', toHouse: 'H2' },
      }),
    ).rejects.toThrow(/19 day\(s\) old — "Market-ready" needs at least 42/);
  });
});

describe('Deaths and abnormal loss (UAT-013 / UAT-017)', () => {
  it('refuses more deaths than there are live birds', async () => {
    await expect(round('2026-01-10', { deaths: 501, causes: ['Disease'] })).rejects.toThrow(/has 500 left — cannot record 501 lost/);
  });

  it('posts a normal loss straight away, and sends an abnormal one for approval instead of posting it', async () => {
    await round('2026-01-10', { deaths: 5, causes: ['Heat stress'] }); // 1% — normal
    await round('2026-01-11', { deaths: 50, causes: ['Disease'] }); // 10% of 495 — abnormal

    const deaths = await prisma.mortalityRecord.findMany({ orderBy: { quantity: 'asc' } });
    expect(deaths.map((d) => [d.quantity, d.classification, d.journalEntryId !== null])).toEqual([
      [5, 'NORMAL', true],
      [50, 'ABNORMAL', false], // not on the books until someone approves it
    ]);
    const claim = await prisma.workflowTransaction.findFirstOrThrow({ where: { transactionType: 'BIOLOGICAL_ASSET_ABNORMAL_MORTALITY' } });
    expect(claim.documentId).toBe(deaths[1]!.id);
    expect(claim.status).toBe('SUBMITTED');
  });
});

describe('Valuation (UAT-014)', () => {
  const value = (over: Record<string, unknown> = {}) =>
    assets.requestValuation({
      companyId: fixture.companyId, groupId: '', valuationDate: new Date('2026-01-31'), marketPricePerUnitKobo: 150_000n,
      costsToSellPerUnitKobo: 5_000n, evidenceReference: 'Market survey, Jan 2026', actor: clerk, ...over,
    } as Parameters<BiologicalAssetService['requestValuation']>[0]);

  it('raises a valuation for approval; it does not touch the books until approved', async () => {
    const group = await prisma.livestockGroup.findFirstOrThrow({ where: { code: 'FLK-1' } });
    const { id } = await value({ groupId: group.id });
    const valuation = await prisma.biologicalAssetValuation.findUniqueOrThrow({ where: { id } });
    expect(valuation.journalEntryId).toBeNull();
    expect(valuation.workflowTransactionId).not.toBeNull();
  });

  it('refuses to value animals that are gone, a price with no evidence, or costs to sell above the price', async () => {
    const group = await prisma.livestockGroup.findFirstOrThrow({ where: { code: 'FLK-1' } });
    await expect(value({ groupId: group.id, evidenceReference: ' ' })).rejects.toThrow(/Name the market evidence/);
    await expect(value({ groupId: group.id, costsToSellPerUnitKobo: 200_000n })).rejects.toThrow(/less than the market price/);
    await expect(value({ groupId: group.id, valuationDate: new Date('2025-12-01') })).rejects.toThrow(/cannot be valued on 2025-12-01/);
    await prisma.livestockGroup.update({ where: { id: group.id }, data: { population: 0, status: 'CLOSED', closedOn: new Date('2026-01-25') } });
    await expect(value({ groupId: group.id })).rejects.toThrow(/no animals left to value/);
  });
});

describe('One round per batch per day (UAT-019)', () => {
  it('refuses a second round for the same batch on the same day', async () => {
    await round('2026-01-10', { production: { whole: 400 } }, 'first');
    await expect(round('2026-01-10', { production: { whole: 400 } }, 'second')).rejects.toThrow(/already/i);
    expect(await prisma.dailyRecord.count()).toBe(1);
  });
});
