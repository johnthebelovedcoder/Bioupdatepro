import { Injectable } from '@nestjs/common';
import { AuditAction } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * Per-company overrides on top of the sidebar's hardcoded role→section map
 * (US-897-035).
 *
 * `apps/web/src/lib/permissions.ts` already says out loud what it is: "a
 * courtesy... nothing here is relied upon for security." This table does not
 * change that boundary — it still only decides what the sidebar offers, never
 * what the API accepts. It exists so an admin who wants FARM_MANAGER to stop
 * seeing `money`, or wants a role's screen back after granting it by mistake,
 * does not need a redeploy to get it.
 *
 * Deliberately an OVERRIDE table, not a full seed of every role×section pair.
 * A row here beats the hardcoded default for that one (role, section); the
 * absence of a row means the hardcoded default still applies. That keeps the
 * common case — a company that never touches this screen — at zero rows, and
 * keeps the hardcoded table as the source of truth for what "no override"
 * means, rather than duplicating it into two hundred seeded rows that could
 * drift from the code they were seeded from.
 */
@Injectable()
export class RoleSectionAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(companyId: string) {
    return this.prisma.roleSectionAccess.findMany({
      where: { companyId },
      orderBy: [{ role: 'asc' }, { section: 'asc' }],
    });
  }

  async set(params: {
    companyId: string;
    actor: WorkflowActor;
    role: string;
    section: string;
    enabled: boolean;
  }) {
    const existing = await this.prisma.roleSectionAccess.findUnique({
      where: {
        companyId_role_section: {
          companyId: params.companyId,
          role: params.role,
          section: params.section,
        },
      },
    });

    const row = await this.prisma.roleSectionAccess.upsert({
      where: {
        companyId_role_section: {
          companyId: params.companyId,
          role: params.role,
          section: params.section,
        },
      },
      create: {
        companyId: params.companyId,
        role: params.role,
        section: params.section,
        enabled: params.enabled,
        updatedById: params.actor.userId,
      },
      update: {
        enabled: params.enabled,
        updatedById: params.actor.userId,
      },
    });

    await this.audit.write({
      transactionId: row.id,
      module: 'AUTH',
      entityType: 'RoleSectionAccess',
      entityId: row.id,
      status: params.enabled ? 'ENABLED' : 'DISABLED',
      action: existing ? AuditAction.UPDATE : AuditAction.CREATE,
      userId: params.actor.userId,
      ipAddress: params.actor.ipAddress ?? null,
      device: params.actor.device ?? null,
      comments: `${params.role} × ${params.section} set to ${params.enabled ? 'visible' : 'hidden'}${existing ? ` (was ${existing.enabled ? 'visible' : 'hidden'})` : ' (new override)'}`,
      oldValue: existing ? { enabled: existing.enabled } : null,
      newValue: { enabled: params.enabled },
    });

    return row;
  }
}
