import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * How a company's own copy of the app is configured.
 *
 * See `CompanyConfig`'s own schema comment for why this exists: it replaces
 * a browser cookie that was never migrated once real tenancy existed. The
 * shape it stores is unchanged from the cookie it replaces — a
 * diff-from-defaults object, never the whole resolved config — only where it
 * lives changes: one row per company instead of one cookie per browser.
 */
@Injectable()
export class FarmConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Null when the company has never saved anything — the caller merges onto its own defaults either way. */
  async get(companyId: string): Promise<unknown | null> {
    const row = await this.prisma.companyConfig.findUnique({ where: { companyId } });
    return row?.overrides ?? null;
  }

  async save(params: { companyId: string; actor: WorkflowActor; overrides: unknown }): Promise<void> {
    if (params.overrides === null || typeof params.overrides !== 'object') {
      throw new BadRequestException('Settings must be an object.');
    }

    const existing = await this.prisma.companyConfig.findUnique({
      where: { companyId: params.companyId },
    });

    const row = await this.prisma.companyConfig.upsert({
      where: { companyId: params.companyId },
      create: {
        companyId: params.companyId,
        overrides: params.overrides as never,
        updatedById: params.actor.userId,
      },
      update: {
        overrides: params.overrides as never,
        updatedById: params.actor.userId,
      },
    });

    await this.audit.write({
      transactionId: row.id,
      module: 'MASTERS',
      entityType: 'CompanyConfig',
      entityId: row.id,
      status: 'UPDATED',
      // Same action `delegation.service.ts` uses for both creating and
      // revoking a delegation — the established fit for "a configuration
      // record's own value changed", not tied to CREATE/UPDATE semantics.
      action: AuditAction.CONFIG_CHANGE,
      userId: params.actor.userId,
      ipAddress: params.actor.ipAddress ?? null,
      device: params.actor.device ?? null,
      comments: 'Farm settings updated',
      oldValue: existing ? (existing.overrides as unknown as Record<string, unknown>) : null,
      newValue: params.overrides as unknown as Record<string, unknown>,
    });
  }

  async reset(params: { companyId: string; actor: WorkflowActor }): Promise<void> {
    const existing = await this.prisma.companyConfig.findUnique({
      where: { companyId: params.companyId },
    });
    if (!existing) return;

    await this.prisma.companyConfig.delete({ where: { companyId: params.companyId } });

    await this.audit.write({
      transactionId: existing.id,
      module: 'MASTERS',
      entityType: 'CompanyConfig',
      entityId: existing.id,
      status: 'UPDATED',
      // No DELETE in the enum — CONFIG_CHANGE is the established fit for
      // "a configuration record's own value changed", which resetting to
      // defaults is, same as `delegation.service.ts`'s own usage of it.
      action: AuditAction.CONFIG_CHANGE,
      userId: params.actor.userId,
      ipAddress: params.actor.ipAddress ?? null,
      device: params.actor.device ?? null,
      comments: 'Farm settings reset to defaults',
      oldValue: existing.overrides as unknown as Record<string, unknown>,
      newValue: null,
    });
  }
}
