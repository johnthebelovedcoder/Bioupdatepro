import { api } from '@/lib/api';
import { formatNaira } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { LeaveDecision, LeavePolicyForm, LeaveRequestForm } from '@/components/leave-forms';

export const metadata = { title: 'Leave — BioAssetPro' };

interface Policy {
  annualDays: number;
  annualServiceMonths: number;
  carryOverYears: number;
  sickDays: number;
  maternityWeeks: number;
  maternityPayPercent: number;
  maternityServiceMonths: number;
  statutory: boolean;
}

interface LeaveRow {
  id: string;
  employee: string;
  type: string;
  startDate: string;
  endDate: string;
  workingDays: number;
  payPercent: number;
  reason: string;
  status: string;
  requestedBy: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
}

interface Balances {
  asOf: string;
  year: number;
  rows: Array<{
    employeeId: string;
    employee: string;
    opening: number;
    earned: number;
    earnedOn: string | null;
    taken: number;
    closing: number;
    lapsingAtYearEnd: number;
    sickUsed: number;
    sickRemaining: number;
    liabilityKobo: string;
  }>;
  totalLiabilityKobo: string;
}

const TONE: Record<string, string> = { APPROVED: 'badge-success', PENDING: 'badge-warning', REJECTED: 'badge-danger', CANCELLED: '' };

async function safe<T>(path: string, fallback: T): Promise<T> {
  try {
    return await api<T>(path);
  } catch {
    return fallback;
  }
}

/**
 * Leave (SOP-038, RPT-HR-007): requests and their approval, and each
 * employee's balance rolled forward with what it is worth.
 */
export default async function LeavePage() {
  const today = new Date().toISOString().slice(0, 10);
  const [policy, requests, balances, employees] = await Promise.all([
    api<Policy>('/leave/policy'),
    safe<LeaveRow[]>('/leave/requests', []),
    safe<Balances | null>('/leave/balances', null),
    safe<Array<{ id: string; employeeNumber: string; name: string; employmentStatus: string }>>('/masters/employees', []),
  ]);
  const active = employees.filter((e) => !['TERMINATED', 'RESIGNED', 'RETIRED'].includes(e.employmentStatus));

  return (
    <>
      <PageHeader title="Leave" subtitle="Requests, approvals, and each person's balance and what it is worth" />
      <Tabs />
      <div className="stack">
        <Card title="Request leave">
          <LeaveRequestForm employees={active.map((e) => ({ id: e.id, label: `${e.employeeNumber} — ${e.name}` }))} today={today} />
        </Card>

        <Card title="Requests" subtitle="Approved by someone other than whoever asked; unpaid days come off the month's pay" padded={false}>
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th style={{ width: 110 }}>Type</th>
                  <th style={{ width: 200 }}>Dates</th>
                  <th className="right" style={{ width: 80 }}>Days</th>
                  <th className="right" style={{ width: 70 }}>Pay</th>
                  <th>Reason</th>
                  <th style={{ width: 210 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="faint">
                      No leave requested yet.
                    </td>
                  </tr>
                ) : (
                  requests.map((r) => (
                    <tr key={r.id}>
                      <td style={{ textAlign: 'left' }}>{r.employee}</td>
                      <td>{r.type.toLowerCase()}</td>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {r.startDate} → {r.endDate}
                      </td>
                      <td className="num right">{r.workingDays}</td>
                      <td className="num right">{r.payPercent}%</td>
                      <td className="faint" style={{ textAlign: 'left' }}>
                        {r.reason}
                        {r.decisionNote ? ` — ${r.decisionNote}` : ''}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                          <span className={`badge ${TONE[r.status] ?? ''}`}>{r.status.toLowerCase()}</span>
                          <LeaveDecision id={r.id} status={r.status} />
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {balances ? (
          <Card
            title={`Balances, ${balances.year} to ${balances.asOf}`}
            subtitle={`Annual leave rolled forward (RPT-HR-007). Liability: ${formatNaira(balances.totalLiabilityKobo)}`}
            padded={false}
          >
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th className="right">Opening</th>
                    <th className="right">Earned</th>
                    <th className="right">Taken</th>
                    <th className="right">Closing</th>
                    <th className="right">Lapses 31 Dec</th>
                    <th className="right">Sick used / left</th>
                    <th className="right" style={{ width: 140 }}>Liability</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.rows.map((b) => (
                    <tr key={b.employeeId}>
                      <td style={{ textAlign: 'left' }}>{b.employee}</td>
                      <td className="num right">{b.opening}</td>
                      <td className="num right" title={b.earnedOn ? `Earned ${b.earnedOn}` : 'Not yet earned this year'}>
                        {b.earned}
                      </td>
                      <td className="num right">{b.taken}</td>
                      <td className="num right">
                        <strong>{b.closing}</strong>
                      </td>
                      <td className="num right">{b.lapsingAtYearEnd}</td>
                      <td className="num right">
                        {b.sickUsed} / {b.sickRemaining}
                      </td>
                      <td className="num right">{formatNaira(b.liabilityKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        <Card
          title="Leave policy"
          subtitle={
            policy.statutory
              ? 'The Nigerian Labour Act minimums: s.18 annual, s.16 sick, s.54 maternity'
              : 'More generous than the Labour Act minimums'
          }
        >
          <LeavePolicyForm policy={policy as unknown as Record<string, number>} />
        </Card>
      </div>
    </>
  );
}
