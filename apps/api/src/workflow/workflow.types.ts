import { Prisma, WorkflowStatus } from '@bioassetpro/database';
import { Kobo } from '../common/money';

/** Who is acting, and from where. Every workflow call carries one. */
export interface WorkflowActor {
  userId: string;
  roles: string[];
  ipAddress?: string | null;
  device?: string | null;
}

/**
 * What a module hands the engine when a document enters approval.
 *
 * Note what is NOT here: no module name in the engine's own logic, no species,
 * no account. `transactionType` is an opaque registered key and `postingPayload`
 * is opaque JSON. That is what makes one engine serve every module (Rule 5).
 */
export interface SubmitRequest {
  companyId: string;
  transactionType: string;
  module: string;
  documentType: string;
  documentId: string;
  documentReference: string;

  /** Routing input. Zero for types where approval does not depend on value. */
  amount: Kobo;
  currencyId: string;

  branchId?: string | null;
  farmId?: string | null;
  departmentId?: string | null;
  costCentreId?: string | null;

  /** Handed to the registered handler if the definition auto-posts. */
  postingPayload?: Prisma.InputJsonValue | null;

  actor: WorkflowActor;
  comments?: string | null;
}

export interface ActionRequest {
  transactionId: string;
  actor: WorkflowActor;
  comments?: string | null;
}

export interface DelegationRequest {
  companyId: string;
  delegatorId: string;
  delegateId: string;
  transactionType?: string | null;
  startDate: Date;
  endDate: Date;
  reason: string;
  actor: WorkflowActor;
}

export interface WorkflowActionResult {
  transactionId: string;
  documentReference: string;
  status: WorkflowStatus;
  /** Null once the transaction is terminal. */
  currentLevel: number | null;
  /** Set when final approval triggered a posting. */
  journalEntryId?: string | null;
}

/**
 * A resolved rung. Computed at submit and then frozen onto the transaction,
 * so later configuration changes cannot rewrite a pending approval chain.
 */
export interface ResolvedStep {
  level: number;
  roleCode: string;
  name: string;
  maxAmountKobo: bigint | null;
}

/**
 * How a transaction type turns into a ledger posting once fully approved.
 *
 * Modules implement and register this. The engine never knows what the payload
 * means — it only knows that when the ladder completes and the definition says
 * auto-post, it calls the handler registered under this transaction type.
 */
export interface WorkflowPostingHandler {
  readonly transactionType: string;
  /**
   * Called inside the approval's database transaction. Returns the journal
   * entry id so workflow and ledger reference each other both ways.
   *
   * A NULL journal id is legitimate and means "approved, nothing to post yet":
   * a delivery note whose company recognises cost of sales at invoice has done
   * real work — stock has moved — but has produced no GL entry. Such a document
   * finishes APPROVED rather than POSTED, which is exactly what it is.
   *
   * Throwing here rolls back the approval as well as the posting: a document
   * cannot be recorded as approved-and-posted when the posting failed.
   */
  post(input: {
    transactionId: string;
    documentReference: string;
    payload: Prisma.JsonValue;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string | null }>;
}

export const WORKFLOW_POSTING_HANDLERS = Symbol('WORKFLOW_POSTING_HANDLERS');
