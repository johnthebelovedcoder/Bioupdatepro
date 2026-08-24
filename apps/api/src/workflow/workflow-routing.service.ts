import { Injectable } from '@nestjs/common';
import { Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingRuleViolation } from '../common/errors';
import { ResolvedStep, SubmitRequest } from './workflow.types';

/**
 * Turns a document into the approval ladder it must climb.
 *
 * Two questions, both driven entirely by configuration (Rule 8):
 *   1. WHICH definition applies — the most specific one whose scope matches.
 *   2. HOW MANY of its rungs this amount requires.
 */
@Injectable()
export class WorkflowRoutingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the definition for a submission.
   *
   * A definition matches when each of its scope columns is either null ("any")
   * or equal to the document's value. Among matches, the most specific wins,
   * specificity being the count of non-null scope columns. That ordering is
   * what lets a company-wide default coexist with a tighter ladder for one farm
   * without either being written twice.
   *
   * Ties are impossible to resolve fairly, so we refuse rather than guess: two
   * equally-specific definitions for the same type is a configuration error, and
   * silently picking one would make approvals depend on row order.
   */
  async resolveDefinition(
    request: SubmitRequest,
    on: Date,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const day = new Date(
      Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate()),
    );

    const candidates = await client.workflowDefinition.findMany({
      where: {
        companyId: request.companyId,
        transactionType: request.transactionType,
        active: true,
        effectiveFrom: { lte: day },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
        AND: [
          { OR: [{ branchId: null }, { branchId: request.branchId ?? undefined }] },
          { OR: [{ farmId: null }, { farmId: request.farmId ?? undefined }] },
          {
            OR: [
              { departmentId: null },
              { departmentId: request.departmentId ?? undefined },
            ],
          },
          {
            OR: [
              { costCentreId: null },
              { costCentreId: request.costCentreId ?? undefined },
            ],
          },
          { OR: [{ currencyId: null }, { currencyId: request.currencyId }] },
        ],
      },
      include: { steps: { orderBy: { level: 'asc' } } },
    });

    if (candidates.length === 0) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §2 — Approval routing',
        `No active workflow definition matches transaction type "${request.transactionType}" ` +
          `for this company and scope on ${day.toISOString().slice(0, 10)}. ` +
          `A transaction type with no route cannot be approved, and must not bypass approval.`,
        { transactionType: request.transactionType, companyId: request.companyId },
      );
    }

    const specificity = (d: (typeof candidates)[number]) =>
      [d.branchId, d.farmId, d.departmentId, d.costCentreId, d.currencyId].filter(
        (v) => v !== null,
      ).length;

    const ranked = [...candidates].sort((a, b) => specificity(b) - specificity(a));
    const best = ranked[0]!;

    if (ranked.length > 1 && specificity(ranked[1]!) === specificity(best)) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §2 — Approval routing',
        `Two workflow definitions match "${request.transactionType}" with equal specificity ` +
          `("${best.name}" and "${ranked[1]!.name}"). Approval routing must be unambiguous; ` +
          `narrow one definition's scope or close it.`,
        { definitionIds: [best.id, ranked[1]!.id] },
      );
    }

    if (best.steps.length === 0) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §2 — Approval routing',
        `Workflow definition "${best.name}" has no approval steps. An empty ladder would ` +
          `let a transaction self-approve, which Rule 4 does not permit.`,
        { definitionId: best.id },
      );
    }

    return best;
  }

  /**
   * Which rungs this amount must climb.
   *
   * Each step's `maxAmountKobo` is its approval ceiling. The chain runs from
   * level 1 up to and including the first step whose ceiling covers the amount;
   * a null ceiling is unlimited and therefore always ends the chain.
   *
   * So with the consultant's example ladder — Farm Manager ₦250k, Finance
   * Manager ₦2m, Controller ₦10m, CEO unlimited — a ₦180k requisition needs one
   * approval, a ₦5m one needs three, and a ₦40m one needs all four. Every
   * approver below the deciding level still signs, which is the point of a
   * ladder rather than a lookup.
   *
   * If the amount exceeds every ceiling and no step is unlimited, the whole
   * ladder is required and the top rung carries it. We do not invent an
   * additional approver that configuration did not define.
   */
  requiredSteps(
    steps: ResolvedStep[],
    amountKobo: bigint,
  ): ResolvedStep[] {
    const ordered = [...steps].sort((a, b) => a.level - b.level);
    const required: ResolvedStep[] = [];

    for (const step of ordered) {
      required.push(step);
      if (step.maxAmountKobo === null || amountKobo <= step.maxAmountKobo) {
        return required;
      }
    }

    return required;
  }
}
