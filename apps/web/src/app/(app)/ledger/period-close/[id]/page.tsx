import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/org';
import { getChecklist, validatePeriod, getReopenRequests } from '@/lib/closing';
import { api } from '@/lib/api';
import type { SessionUser } from '@/lib/session';
import { formatDate, formatNaira } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import {
  PrepareChecklistButton,
  ChecklistItemActions,
  ClosePeriodButton,
  RequestReopenForm,
  ReopenRequestActions,
} from '@/components/period-close-actions';

export const metadata = { title: 'Period close — BioAssetPro' };

const STATUS_TONE: Record<string, string> = {
  OPEN: '',
  SOFT_CLOSED: 'badge-warning',
  CLOSED: 'badge-success',
  ARCHIVED: '',
};

export default async function PeriodCloseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [context, me] = await Promise.all([getContext(), api<SessionUser>('/auth/me')]);

  const period = context.financialYears.flatMap((y) => y.periods).find((p) => p.id === id);
  if (!period) notFound();

  const [checklist, validation, reopenRequests] = await Promise.all([
    getChecklist(id).catch(() => []),
    period.status !== 'ARCHIVED' ? validatePeriod(id).catch(() => null) : Promise.resolve(null),
    period.status === 'CLOSED' ? getReopenRequests(id) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title={period.name}
        subtitle="Checklist, validation and close"
        actions={
          <Link href="/ledger/period-close" className="btn btn-ghost">
            Back to periods
          </Link>
        }
      />

      <div className="stack">
        <Card title="Status">
          <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'center' }}>
            <span className={`badge ${STATUS_TONE[period.status] ?? ''}`} style={{ textTransform: 'none' }}>
              {period.status.toLowerCase().replace(/_/g, ' ')}
            </span>
            <span className="faint">
              {formatDate(period.startDate)} – {formatDate(period.endDate)}
            </span>
          </div>
        </Card>

        <Card
          title="Closing checklist"
          subtitle="Each step recorded against the person who cleared it"
          padded={false}
        >
          {checklist.length === 0 ? (
            <div style={{ padding: 'var(--sp-5)' }}>
              <p className="faint" style={{ marginBottom: 'var(--sp-4)' }}>
                No checklist yet for this period.
              </p>
              <PrepareChecklistButton periodId={id} />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>Code</th>
                    <th>Step</th>
                    <th style={{ width: 100 }}>Required</th>
                    <th style={{ width: 110 }}>Status</th>
                    <th style={{ width: 260 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {checklist.map((item) => (
                    <tr key={item.id}>
                      <td className="faint">{item.code}</td>
                      <td style={{ textAlign: 'left' }}>
                        {item.name}
                        {item.comments ? <div className="faint">{item.comments}</div> : null}
                      </td>
                      <td>{item.blocking ? 'Blocking' : 'Optional'}</td>
                      <td>
                        <span
                          className={`badge ${
                            item.status === 'COMPLETE'
                              ? 'badge-success'
                              : item.status === 'FAILED'
                                ? 'badge-danger'
                                : item.status === 'WAIVED'
                                  ? 'badge-warning'
                                  : ''
                          }`}
                        >
                          {item.status.toLowerCase()}
                        </span>
                      </td>
                      <td>
                        <ChecklistItemActions periodId={id} item={item} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {validation ? (
          <Card
            title="Validation"
            subtitle={validation.canClose ? 'Every blocking check passes' : 'Blocking findings remain'}
          >
            <div className="stack" style={{ gap: 'var(--sp-3)' }}>
              <div className="row" style={{ gap: 'var(--sp-4)' }}>
                <span>
                  Trial balance:{' '}
                  <strong>{validation.trialBalance.balanced ? 'balanced' : 'NOT balanced'}</strong>
                </span>
                <span className="faint">
                  Dr {formatNaira(validation.trialBalance.totalDebitKobo)} · Cr{' '}
                  {formatNaira(validation.trialBalance.totalCreditKobo)}
                </span>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Check</th>
                      <th style={{ width: 100 }}>Blocking</th>
                      <th style={{ width: 100 }}>Result</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validation.findings.map((finding) => (
                      <tr key={finding.code}>
                        <td style={{ textAlign: 'left' }}>{finding.name}</td>
                        <td>{finding.blocking ? 'Yes' : 'No'}</td>
                        <td>
                          <span className={`badge ${finding.passed ? 'badge-success' : 'badge-danger'}`}>
                            {finding.passed ? 'pass' : 'fail'}
                          </span>
                        </td>
                        <td className="faint" style={{ textAlign: 'left' }}>
                          {finding.detail}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        ) : null}

        {period.status === 'OPEN' || period.status === 'SOFT_CLOSED' ? (
          <Card title="Close this period">
            <div className="row" style={{ gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
              {period.status === 'OPEN' ? (
                <ClosePeriodButton
                  periodId={id}
                  action="soft-close"
                  label="Soft-close"
                  pendingLabel="Soft-closing…"
                  canClose
                />
              ) : null}
              <ClosePeriodButton
                periodId={id}
                action="close"
                label="Close"
                pendingLabel="Closing…"
                canClose={validation?.canClose ?? false}
              />
            </div>
          </Card>
        ) : null}

        {period.status === 'CLOSED' ? (
          <Card title="Reopen" subtitle="Changes figures already reported — needs a second person to approve">
            <div className="stack" style={{ gap: 'var(--sp-4)' }}>
              <RequestReopenForm periodId={id} />

              {reopenRequests.length > 0 ? (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Requested by</th>
                        <th>Reason</th>
                        <th style={{ width: 110 }}>Requested</th>
                        <th style={{ width: 130 }}>Status</th>
                        <th style={{ width: 160 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {reopenRequests.map((r) => {
                        const isOwn = r.requestedById === me.userId;
                        const status = r.reopenedAt ? 'reopened' : r.approvedAt ? 'approved' : 'pending';
                        return (
                          <tr key={r.id}>
                            <td style={{ textAlign: 'left' }}>{r.requestedByName}</td>
                            <td className="faint" style={{ textAlign: 'left' }}>
                              {r.reason}
                            </td>
                            <td className="num" style={{ textAlign: 'left' }}>
                              {formatDate(r.requestedAt)}
                            </td>
                            <td>
                              <span
                                className={`badge ${status === 'reopened' ? 'badge-success' : status === 'approved' ? 'badge-warning' : ''}`}
                              >
                                {status}
                              </span>
                            </td>
                            <td>
                              <ReopenRequestActions
                                periodId={id}
                                requestId={r.id}
                                canApprove={!r.approvedAt && !isOwn}
                                canReopen={!!r.approvedAt && !r.reopenedAt}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
