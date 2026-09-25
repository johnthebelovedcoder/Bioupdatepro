import { api } from '@/lib/api';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import type { SessionUser } from '@/lib/session';
import { setSelfApproval } from './actions';

export const metadata = { title: 'Approval rules — BioAssetPro' };

interface ApprovalSettings {
  allowSelfApproval: boolean;
  waitingOnlyTheMakerCanApprove: number;
}

/**
 * Whether a maker may approve their own document when nobody else in the
 * farm can. Off by default: the client's SYSTEM_INTEGRITY_MATRIX says a
 * maker approving their own transaction must never happen. A one-person farm
 * cannot post anything without it, so the choice is the farm's, made by the
 * CFO or an administrator, and recorded in the audit trail.
 */
export default async function ApprovalRulesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [params, me, settings] = await Promise.all([
    searchParams,
    api<SessionUser>('/auth/me'),
    api<ApprovalSettings>('/workflow/settings').catch(() => null),
  ]);
  const canChange = me.roles.includes('CFO') || me.roles.includes('ADMINISTRATOR');

  return (
    <div className="stack">
      <PageHeader title="Approval rules" subtitle="Who may approve what, when a farm has only one approver" />
      <Tabs />

      {params.error ? <div className="notice notice-error">{params.error}</div> : null}

      <Card
        title="Self-approval"
        subtitle={settings?.allowSelfApproval ? 'On — makers may approve their own work when nobody else can' : 'Off — nobody approves their own work'}
      >
        {!settings ? (
          <p className="muted">This setting could not be read.</p>
        ) : (
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <p style={{ fontSize: 14 }}>
              Normally whoever raises a document — an order, a payroll run, a journal — cannot approve it; someone
              else must. On a farm where only one person holds the authority, that means nothing can ever be approved.
              Turning this on lets that person approve their own work, <strong>only</strong> when no one else in the
              farm could. Each one is marked <em>self-approved</em> on the document, in its history and in the audit
              trail. Timesheet hours follow the same rule.
            </p>
            <div className="notice notice-warning">
              The client specification treats a maker approving their own transaction as a control failure. Leave this
              off unless the farm genuinely has one approver and accepts that risk.
            </div>
            {settings.waitingOnlyTheMakerCanApprove > 0 ? (
              <p className="faint">
                {settings.waitingOnlyTheMakerCanApprove} waiting document
                {settings.waitingOnlyTheMakerCanApprove === 1 ? ' has' : 's have'} nobody but {settings.waitingOnlyTheMakerCanApprove === 1 ? 'its' : 'their'} maker
                able to approve {settings.waitingOnlyTheMakerCanApprove === 1 ? 'it' : 'them'}
                {settings.allowSelfApproval ? '.' : ' — they stay waiting while this is off, unless another approver joins.'}
              </p>
            ) : null}
            {canChange ? (
              <form action={setSelfApproval}>
                <input type="hidden" name="allow" value={settings.allowSelfApproval ? 'false' : 'true'} />
                <button type="submit" className={`btn ${settings.allowSelfApproval ? 'btn-ghost' : 'btn-primary'}`}>
                  {settings.allowSelfApproval ? 'Turn self-approval off' : 'Turn self-approval on'}
                </button>
              </form>
            ) : (
              <p className="faint">Only the CFO or an administrator can change this.</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
