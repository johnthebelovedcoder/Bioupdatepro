import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * The vaccination and health programme (REPORT_KPI_CATALOG PLY-008,
 * handbook "Vaccination & Health Compliance"): what is scheduled for each
 * batch, stood down with a reason when a vet says so, and whether it was
 * given on time.
 *
 * Until 2026-09-27 only the demo seed could put an event on the schedule, so
 * a farm could record treatments but never say what was due — and compliance
 * could not be measured. Recording a treatment against a scheduled event
 * (OperationsService.recordTreatment) marks it done; this plans it and reads
 * the result.
 */
const KINDS = ['Vaccination', 'Deworming', 'Treatment', 'Vitamin', 'Health check'] as const;
const DAY = 86_400_000;
const dateOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

@Injectable()
export class HealthScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async schedule(params: {
    companyId: string;
    actor: WorkflowActor;
    groupCode: string;
    kind: string;
    name: string;
    dueOn: Date;
    detail?: string | null;
  }) {
    const name = params.name?.trim();
    if (!name) throw new BadRequestException('Name the vaccine or treatment.');
    if (!(KINDS as readonly string[]).includes(params.kind)) throw new BadRequestException(`Kind is one of: ${KINDS.join(', ')}.`);
    if (Number.isNaN(params.dueOn.getTime())) throw new BadRequestException('Give the date it is due.');
    const group = await this.prisma.livestockGroup.findFirst({ where: { companyId: params.companyId, code: params.groupCode.trim() } });
    if (!group) throw new NotFoundException(`No batch with the code ${params.groupCode}.`);
    if (group.status !== 'ACTIVE') throw new BadRequestException(`${group.code} is closed; nothing more can be scheduled for it.`);
    if (params.dueOn < dateOnly(group.startedOn)) throw new BadRequestException(`${group.code} was placed on ${group.startedOn.toISOString().slice(0, 10)}; it cannot be due before then.`);

    const event = await this.prisma.healthEvent.create({
      data: { companyId: params.companyId, groupId: group.id, kind: params.kind, name, detail: params.detail?.trim() || null, dueOn: dateOnly(params.dueOn) },
    });
    await this.audit.write({
      transactionId: event.id, module: 'OPERATIONS', entityType: 'HealthEvent', entityId: event.id, status: 'DUE', action: AuditAction.CREATE,
      userId: params.actor.userId, ipAddress: params.actor.ipAddress ?? null, device: params.actor.device ?? null,
      comments: `${params.kind} ${name} scheduled for ${group.code} on ${event.dueOn.toISOString().slice(0, 10)}`,
    });
    return event;
  }

  /** A vet stands it down, or the programme changed: not given, and not counted as missed. */
  async skip(params: { companyId: string; actor: WorkflowActor; eventId: string; reason: string }) {
    const reason = params.reason?.trim();
    if (!reason) throw new BadRequestException('Say why it is not being given.');
    const event = await this.prisma.healthEvent.findFirst({ where: { id: params.eventId, companyId: params.companyId } });
    if (!event) throw new NotFoundException('No such scheduled event.');
    if (event.status === 'DONE' || event.status === 'SKIPPED') throw new BadRequestException(`It is already ${event.status.toLowerCase()}.`);
    const updated = await this.prisma.healthEvent.update({ where: { id: event.id }, data: { status: 'SKIPPED', detail: [event.detail, `Not given: ${reason}`].filter(Boolean).join(' · ') } });
    await this.audit.write({
      transactionId: event.id, module: 'OPERATIONS', entityType: 'HealthEvent', entityId: event.id, status: 'SKIPPED', action: AuditAction.UPDATE,
      userId: params.actor.userId, ipAddress: params.actor.ipAddress ?? null, device: params.actor.device ?? null, comments: `Not given: ${reason}`,
    });
    return updated;
  }

  /**
   * Of what fell due by `asOf`: given on or before its due date, given late,
   * still not given (overdue), or stood down. Compliance is on time ÷ what
   * should have been given (due, less stood down).
   */
  async compliance(params: { companyId: string; speciesKey?: string; asOf?: Date }) {
    const asOf = dateOnly(params.asOf ?? new Date());
    const events = await this.prisma.healthEvent.findMany({
      where: { companyId: params.companyId, dueOn: { lte: asOf }, ...(params.speciesKey ? { group: { speciesKey: params.speciesKey } } : {}) },
      select: {
        id: true, kind: true, name: true, dueOn: true, status: true,
        group: { select: { code: true } },
        treatments: { select: { givenOn: true, productBatch: true, withdrawalDays: true }, orderBy: { givenOn: 'asc' }, take: 1 },
      },
      orderBy: { dueOn: 'asc' },
    });
    const rows = events.map((e) => {
      const given = e.treatments[0];
      const outcome =
        e.status === 'SKIPPED' ? 'SKIPPED'
        : given ? (dateOnly(given.givenOn) <= e.dueOn ? 'ON_TIME' : 'LATE')
        : e.status === 'DONE' ? 'ON_TIME'
        : 'OVERDUE';
      return {
        id: e.id,
        groupCode: e.group.code,
        kind: e.kind,
        name: e.name,
        dueOn: e.dueOn.toISOString().slice(0, 10),
        givenOn: given ? given.givenOn.toISOString().slice(0, 10) : null,
        daysLate: given ? Math.max(0, Math.round((dateOnly(given.givenOn).getTime() - e.dueOn.getTime()) / DAY)) : Math.round((asOf.getTime() - e.dueOn.getTime()) / DAY),
        productBatch: given?.productBatch ?? null,
        withdrawalDays: given?.withdrawalDays ?? null,
        outcome,
      };
    });
    const count = (o: string) => rows.filter((r) => r.outcome === o).length;
    const expected = rows.length - count('SKIPPED');
    return {
      asOf: asOf.toISOString().slice(0, 10),
      due: rows.length,
      onTime: count('ON_TIME'),
      late: count('LATE'),
      overdue: count('OVERDUE'),
      skipped: count('SKIPPED'),
      /** On time ÷ what should have been given, as a percentage; null when nothing was due. */
      compliancePercent: expected > 0 ? ((count('ON_TIME') / expected) * 100).toFixed(1) : null,
      rows,
    };
  }
}
