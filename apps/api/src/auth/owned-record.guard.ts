import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthenticatedUser } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A record addressed by its own id must belong to the caller's company.
 *
 * CompanyScopeGuard closed the case where a request NAMES a company. This is
 * the case it explicitly could not cover, and said so: a request for
 * `/journals/<another tenant's journal id>` names no company at all, so nothing
 * objected. Being signed in proved who you were; it did not prove the row was
 * yours. There are thirty-nine routes in this API addressed that way.
 *
 * Fixing them one at a time would mean threading a company through thirty-nine
 * service signatures and their tests, and leaving the same trap set for the
 * fortieth. So the check lives here and is asked for declaratively:
 *
 *     @OwnedRecord('journalEntry', 'journalEntryId')
 *     @Get('journals/:journalEntryId')
 *
 * Two deliberate choices:
 *
 *   · A record belonging to someone else raises NOT FOUND, not FORBIDDEN.
 *     Forbidden would confirm the id exists, which turns the endpoint into an
 *     oracle for enumerating another tenant's primary keys. From this caller's
 *     position the record genuinely does not exist.
 *
 *   · An id that resolves to nothing is left alone and passes through, so the
 *     handler produces its own 404 with its own wording. The guard's job is
 *     ownership, not existence.
 *
 * The resolver table below is written out per model rather than derived. Three
 * of these reach their company through a parent, and a clever generic version
 * that guessed would be a security control nobody could audit by reading it.
 */

export const OWNED_RECORD_KEY = 'ownedRecord';

export interface OwnedRecordRule {
  /** A key of RESOLVERS below. */
  model: string;
  /** The route parameter holding the id. */
  param: string;
}

export const OwnedRecord = (model: keyof typeof RESOLVERS, param: string) =>
  SetMetadata(OWNED_RECORD_KEY, { model, param } satisfies OwnedRecordRule);

/**
 * How each model answers "which company owns this?".
 *
 * Returns the owning company id, or null when the record does not exist.
 */
const RESOLVERS = {
  journalEntry: async (prisma: PrismaService, id: string) =>
    (await prisma.journalEntry.findUnique({ where: { id }, select: { companyId: true } }))
      ?.companyId ?? null,

  financialYear: async (prisma: PrismaService, id: string) =>
    (await prisma.financialYear.findUnique({ where: { id }, select: { companyId: true } }))
      ?.companyId ?? null,

  // Reaches its company through the year it belongs to.
  financialPeriod: async (prisma: PrismaService, id: string) =>
    (
      await prisma.financialPeriod.findUnique({
        where: { id },
        select: { financialYear: { select: { companyId: true } } },
      })
    )?.financialYear.companyId ?? null,

  // And this through the period.
  periodCloseChecklist: async (prisma: PrismaService, id: string) =>
    (
      await prisma.periodCloseChecklist.findUnique({
        where: { id },
        select: { financialPeriod: { select: { financialYear: { select: { companyId: true } } } } },
      })
    )?.financialPeriod.financialYear.companyId ?? null,

  periodReopenRequest: async (prisma: PrismaService, id: string) =>
    (await prisma.periodReopenRequest.findUnique({ where: { id }, select: { companyId: true } }))
      ?.companyId ?? null,

  supplier: async (prisma: PrismaService, id: string) =>
    (await prisma.supplier.findUnique({ where: { id }, select: { companyId: true } }))
      ?.companyId ?? null,

  customer: async (prisma: PrismaService, id: string) =>
    (await prisma.customer.findUnique({ where: { id }, select: { companyId: true } }))
      ?.companyId ?? null,

  item: async (prisma: PrismaService, id: string) =>
    (await prisma.item.findUnique({ where: { id }, select: { companyId: true } }))?.companyId ??
    null,

  employee: async (prisma: PrismaService, id: string) =>
    (await prisma.employee.findUnique({ where: { id }, select: { companyId: true } }))
      ?.companyId ?? null,

  // Through the recipe it is a version of.
  productRecipeVersion: async (prisma: PrismaService, id: string) =>
    (
      await prisma.productRecipeVersion.findUnique({
        where: { id },
        select: { recipe: { select: { companyId: true } } },
      })
    )?.recipe.companyId ?? null,

  payrollRun: async (prisma: PrismaService, id: string) =>
    (await prisma.payrollRun.findUnique({ where: { id }, select: { companyId: true } }))
      ?.companyId ?? null,

  taxPeriod: async (prisma: PrismaService, id: string) =>
    (await prisma.taxPeriod.findUnique({ where: { id }, select: { companyId: true } }))
      ?.companyId ?? null,

  workflowDelegation: async (prisma: PrismaService, id: string) =>
    (await prisma.workflowDelegation.findUnique({ where: { id }, select: { companyId: true } }))
      ?.companyId ?? null,

  workflowTransaction: async (prisma: PrismaService, id: string) =>
    (await prisma.workflowTransaction.findUnique({ where: { id }, select: { companyId: true } }))
      ?.companyId ?? null,
} as const;

@Injectable()
export class OwnedRecordGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<OwnedRecordRule | undefined>(
      OWNED_RECORD_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!rule) return true;
    if (context.getType() !== 'http') return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();

    const id = request.params?.[rule.param];
    if (typeof id !== 'string' || id.trim() === '') return true;

    const resolve = RESOLVERS[rule.model as keyof typeof RESOLVERS];
    if (!resolve) {
      // A rule naming a model with no resolver is a programming error, and
      // failing open would make it a silent one.
      throw new Error(`No ownership resolver for "${rule.model}".`);
    }

    let owner: string | null;
    try {
      owner = await resolve(this.prisma, id);
    } catch {
      /*
       * A malformed uuid throws inside Prisma rather than returning null.
       * Refusing here rather than passing it on: such an id cannot be anybody's
       * record, and letting it reach the handler produced a 500 for what is
       * plainly a bad request — the same answer as any other id that resolves
       * to nothing.
       */
      throw new NotFoundException('No such record.');
    }

    // Not found. The handler's own 404 will be better worded than ours.
    if (owner === null) return true;

    if (owner !== request.user?.companyId) {
      throw new NotFoundException('No such record.');
    }
    return true;
  }
}
