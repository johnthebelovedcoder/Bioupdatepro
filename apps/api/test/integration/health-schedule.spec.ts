import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { StockMovementService } from '../../src/inventory/stock-movement.service';
import { RearingCostService } from '../../src/biological-assets/rearing-cost.service';
import { BiologicalAssetService } from '../../src/biological-assets/biological-asset.service';
import { OperationsPostingService } from '../../src/operations/operations-posting.service';
import { OperationsService } from '../../src/operations/operations.service';
import { OperationsReadService } from '../../src/operations/operations-read.service';
import { BatchProfileService } from '../../src/operations/batch-profile.service';
import { HealthScheduleService } from '../../src/operations/health-schedule.service';
import { MortalityReportService } from '../../src/operations/mortality-report.service';
import { WorkflowService } from '../../src/workflow/workflow.service';
import { WorkflowRoutingService } from '../../src/workflow/workflow-routing.service';
import { DelegationService } from '../../src/workflow/delegation.service';
import { NotificationService } from '../../src/workflow/notification.service';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/** Vaccination and health compliance (REPORT_KPI_CATALOG PLY-008). */

let prisma: PrismaService;
let operations: OperationsService;
let schedule: HealthScheduleService;
let reads: OperationsReadService;
let fixture: TestFixture;
const actor = () => ({ userId: fixture.makerId, roles: ['FARM_MANAGER'] });

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  const workflow = new WorkflowService(prisma, new WorkflowRoutingService(prisma), new DelegationService(prisma, audit), new NotificationService(prisma), audit);
  const rearing = new RearingCostService(prisma, posting);
  const stock = new StockMovementService(prisma);
  operations = new OperationsService(
    prisma, new IdempotencyService(prisma), audit, new OperationsPostingService(prisma, posting, rearing, stock),
    new BiologicalAssetService(prisma, posting, workflow, audit, rearing), new BatchProfileService(prisma, audit),
  );
  schedule = new HealthScheduleService(prisma, audit);
  reads = new OperationsReadService(prisma);
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: 'H1', name: 'House 1' } });
  await operations.placeGroup({
    companyId: fixture.companyId, actor: actor(), idempotencyKey: 'place',
    payload: { module: 'poultry', code: 'LAY-1', breed: 'ISA Brown', purpose: 'Layer', stage: 'Chick', house: 'H1', openingPopulation: 500, startedOn: '2026-01-01' },
  });
});

const give = (eventId: string, date: string) =>
  operations.recordTreatment({
    companyId: fixture.companyId, actor: actor(), idempotencyKey: `give-${eventId}`,
    payload: { groupCode: 'LAY-1', eventId, name: 'as scheduled', date, givenBy: 'Vet', route: 'In drinking water', treated: 500, withdrawalDays: 0, productBatch: 'VAC-001' },
  });

describe('Vaccination and health compliance (PLY-008)', () => {
  it('schedules a programme, and scores what was given on time, late, not at all, or stood down', async () => {
    const at = (dueOn: string, name: string, kind = 'Vaccination') => schedule.schedule({ companyId: fixture.companyId, actor: actor(), groupCode: 'LAY-1', kind, name, dueOn: new Date(dueOn) });
    const newcastle = await at('2026-01-07', 'Newcastle (Lasota)');
    const gumboro = await at('2026-01-14', 'Gumboro');
    await at('2026-01-21', 'Fowl pox');
    const deworm = await at('2026-02-01', 'Piperazine', 'Deworming');
    await at('2099-01-01', 'Not due yet');

    await give(newcastle.id, '2026-01-07'); // on the day
    await give(gumboro.id, '2026-01-17'); // three days late
    await schedule.skip({ companyId: fixture.companyId, actor: actor(), eventId: deworm.id, reason: 'Vet: worm count clear' });

    const result = await schedule.compliance({ companyId: fixture.companyId, speciesKey: 'poultry' });
    expect(result).toMatchObject({ due: 4, onTime: 1, late: 1, overdue: 1, skipped: 1, compliancePercent: '33.3' });
    expect(result.rows.find((r) => r.name === 'Gumboro')).toMatchObject({ outcome: 'LATE', givenOn: '2026-01-17', daysLate: 3, productBatch: 'VAC-001' });
    expect(result.rows.find((r) => r.name === 'Fowl pox')!.outcome).toBe('OVERDUE');

    // The schedule screen shows the unrecorded one as overdue, not merely due.
    const shown = await reads.health(fixture.companyId, 'poultry');
    expect(shown.find((e) => e.name === 'Fowl pox')!.status).toBe('OVERDUE');
    expect(shown.find((e) => e.name === 'Not due yet')!.status).toBe('DUE');
  });

  it('refuses what cannot be scheduled, and a stand-down without a reason', async () => {
    await expect(schedule.schedule({ companyId: fixture.companyId, actor: actor(), groupCode: 'NOPE', kind: 'Vaccination', name: 'X', dueOn: new Date('2026-02-01') })).rejects.toThrow(/No batch/);
    await expect(schedule.schedule({ companyId: fixture.companyId, actor: actor(), groupCode: 'LAY-1', kind: 'Magic', name: 'X', dueOn: new Date('2026-02-01') })).rejects.toThrow(/Kind is one of/);
    await expect(schedule.schedule({ companyId: fixture.companyId, actor: actor(), groupCode: 'LAY-1', kind: 'Vaccination', name: 'X', dueOn: new Date('2025-12-01') })).rejects.toThrow(/cannot be due before/);
    const event = await schedule.schedule({ companyId: fixture.companyId, actor: actor(), groupCode: 'LAY-1', kind: 'Vaccination', name: 'Marek', dueOn: new Date('2026-01-02') });
    await expect(schedule.skip({ companyId: fixture.companyId, actor: actor(), eventId: event.id, reason: ' ' })).rejects.toThrow(/Say why/);
  });

  it('reports culls apart from deaths, with each as a share of what was placed (PLY-004)', async () => {
    await operations.recordRound({
      companyId: fixture.companyId, actor: actor(), idempotencyKey: 'round-1',
      payload: { module: 'poultry', date: '2026-01-10', entries: [{ groupCode: 'LAY-1', deaths: 5, causes: ['Heat stress', 'Crowding'] }] },
    });
    const group = await prisma.livestockGroup.findFirstOrThrow({ where: { companyId: fixture.companyId, code: 'LAY-1' } });
    await prisma.livestockGroupDisposal.create({
      data: { groupId: group.id, quantity: 10, fvlctsPerUnitKobo: 0n, carryingAmountKobo: 0n, occurredOn: new Date('2026-01-12'), method: 'CULLED' },
    });
    const report = await new MortalityReportService(prisma).report({ companyId: fixture.companyId, speciesKey: 'poultry' });
    expect(report.totals).toMatchObject({ placed: 500, deaths: 5, culls: 10, mortalityPercent: '1.00', cullPercent: '2.00' });
    // One death with two causes is counted once.
    expect(report.byCause).toEqual([{ key: 'Heat stress + Crowding', deaths: 5 }]);
  });
});
