import 'server-only';
import { api, ApiError } from './api';

/**
 * The ledger's self-checks: are the posting rules complete, does every
 * control account agree with its subledger, and who signed off a release
 * knowing what.
 */

export type Loaded<T> = { ok: true; data: T } | { ok: false; error: string };

async function load<T>(path: string): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await api<T>(path) };
  } catch (caught) {
    if (caught instanceof ApiError) return { ok: false, error: caught.message };
    throw caught;
  }
}

export interface CheckRow {
  id: string;
  what: string;
  expected: string;
  found: string;
  state: 'PASS' | 'FAIL' | 'BLOCKED';
  next?: string;
}

export interface ControlReconciliationRow {
  accountNumber: string;
  accountName: string;
  glBalanceKobo: string;
  subledgerKobo: string;
  varianceKobo: string;
  reconciled: boolean;
  source: string;
}

export interface ReleaseSignOff {
  id: string;
  occurredAt: string;
  status: string;
  signedOffBy: string;
  exceptionsAcknowledged: string | null;
  snapshot: { releaseLabel?: string; failingCheckCount?: number; variantAccountCount?: number } | null;
}

export interface BuildPhase {
  code: string;
  sequence: number;
  name: string;
  scope: string | null;
  owner: string | null;
  exitEvidence: string | null;
  dependencyCodes: string[];
  webPath: string | null;
  hasEvidence: boolean;
  signal: string | null;
}

export interface PostingSide {
  key: string;
  code: string | null;
  name: string;
  ledgerFlag: string;
  flagConflict: string | null;
  resolved: boolean;
  dynamicResolution: string | null;
}

export interface PostingRule {
  ruleId: string;
  module: string;
  cycle: string;
  trigger: string;
  sourceDocument: string;
  scenario: string | null;
  measurementBasis: string;
  requiredDimensions: string[] | string;
  makerRole: string;
  approverRole: string;
  blockingControl: string;
  reversalMethod: string;
  status: string;
  version: number;
  debit: PostingSide | null;
  credit: PostingSide | null;
  postsNothing: boolean;
}

export type ResolvedRule =
  | {
      resolvable: true;
      ruleId: string;
      version: number;
      debit: { accountNumber: string; accountName: string; ledgerFlag: string } | null;
      credit: { accountNumber: string; accountName: string; ledgerFlag: string } | null;
      postsNothing: boolean;
    }
  | { resolvable: false; ruleId: string; reason: string };

export const getPostingChecks = () =>
  load<{ rows: CheckRow[]; releasable: boolean }>('/posting-control/checks');
export const getControlReconciliation = () =>
  load<ControlReconciliationRow[]>('/reporting/control-reconciliation');
export const getReleaseSignOffs = () => load<ReleaseSignOff[]>('/reporting/release-sign-offs');
export const getBuildOrder = () => load<BuildPhase[]>('/reporting/build-order');
export const getPostingRules = (cycle?: string) =>
  load<PostingRule[]>(`/posting-control/rules${cycle ? `?cycle=${encodeURIComponent(cycle)}` : ''}`);
export const resolvePostingRule = (ruleId: string) =>
  load<ResolvedRule>(`/posting-control/rules/${encodeURIComponent(ruleId)}`);

export interface PostingControlStatus {
  loaded: boolean;
  rules: number;
  keys: number;
  expectedRules: number;
  expectedKeys: number;
  chartVersion: 'LEGACY' | 'SPEC';
}

export const getPostingControlStatus = () =>
  load<PostingControlStatus>('/posting-control/provisioning');

/* --- Moving to the six-digit chart ---------------------------------------- */

export type ProductClass = 'LIVE_POULTRY' | 'EGGS' | 'PROCESSED_POULTRY' | 'LIVE_SNAIL' | 'PROCESSED_SNAIL';

export interface UnificationPreview {
  cutoverDate: string | null;
  chartVersion?: 'LEGACY' | 'SPEC';
  canRun: boolean;
  blockers: string[];
  warnings: string[];
  accounts: Array<{
    from: string;
    name: string;
    balanceKobo: string;
    moves: Array<{ to: string; amountKobo: string; basis: string; assumed: boolean }>;
  }>;
  items: Array<{ itemId: string; code: string; description: string; proposed: ProductClass | null; chosen: ProductClass; feed: boolean }>;
  untouched: Array<{ accountNumber: string; name: string; balanceKobo: string }>;
  classes: Record<ProductClass, { label: string; revenue: string; costOfSales: string; inventory: string }>;
}

export const getUnificationPreview = (cutover?: string) =>
  load<UnificationPreview>(`/posting-control/chart-unification${cutover ? `?cutover=${encodeURIComponent(cutover)}` : ''}`);
