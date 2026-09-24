import { getPayrollSetupStatus } from '@/lib/payroll';
import { getPayeBands } from '@/lib/payroll-runs';
import { api } from '@/lib/api';
import { formatDate, formatNaira } from '@/lib/money';
import { Card, PageHeader, Stat } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { ActivatePayrollForm } from '@/components/activate-payroll-form';
import { SalaryCostCalculator } from '@/components/salary-cost-calculator';

export const metadata = { title: 'Payroll setup — BioAssetPro' };

/**
 * Whether this company can run payroll yet, and the one switch to flip if not.
 *
 * §7.2's statutory engine refuses to calculate PAYE, pension, NHF, NSITF or
 * ITF without an effective `StatutoryConfiguration` — correctly, since those
 * are legal rates it will not assume. What was missing was anywhere to
 * create one outside `seed.ts`'s dev fixtures: a real company signed up
 * through the actual onboarding flow had no path to it at all.
 */
export default async function PayrollSetupPage() {
  const [status, bands, employees] = await Promise.all([
    getPayrollSetupStatus(),
    getPayeBands(),
    api<unknown[]>('/masters/employees').catch(() => []),
  ]);

  return (
    <>
      <PageHeader
        title="Payroll setup"
        subtitle="Turn on the statutory rates payroll runs against"
        actions={status.active ? <SalaryCostCalculator employeeCount={employees.length} /> : null}
      />

      <Tabs />

      <div className="stack">
        <div className="stat-grid">
          <Stat
            label="Status"
            value={status.active ? 'Active' : 'Not active'}
            goodWhen={status.active ? 'up' : 'down'}
          />
          <Stat label="PAYE bands" value={String(status.payeBandCount)} />
          <Stat label="Rule version" value={status.ruleVersion ?? '—'} />
          <Stat
            label="NHF participation"
            value={
              status.nhfCompanyParticipation === null
                ? '—'
                : status.nhfCompanyParticipation
                  ? 'On'
                  : 'Off'
            }
          />
        </div>

        {status.active ? (
          <Card>
            <p style={{ fontSize: 14, lineHeight: 1.6 }}>
              Payroll is active, effective{' '}
              {status.effectiveFrom ? formatDate(status.effectiveFrom) : '—'}, under rule set{' '}
              <strong>{status.ruleVersion}</strong>. Every payslip this company runs is
              calculated against these rates until a new effective-dated row supersedes them —
              past payroll runs will still reproduce exactly even after a rate change.
            </p>
          </Card>
        ) : (
          <ActivatePayrollForm />
        )}

        {bands.length > 0 ? (
          <Card
            title="PAYE bands in force"
            subtitle="Annual chargeable income, taxed band by band"
            padded={false}
          >
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>#</th>
                    <th className="right">From</th>
                    <th className="right">To</th>
                    <th className="right" style={{ width: 90 }}>Rate</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {bands.map((band) => (
                    <tr key={band.bandOrder}>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {band.bandOrder}
                      </td>
                      <td className="num">{formatNaira(band.lowerLimitKobo)}</td>
                      <td className="num">
                        {band.upperLimitKobo ? formatNaira(band.upperLimitKobo) : 'and above'}
                      </td>
                      <td className="num">{Number((Number(band.rate) * 100).toFixed(4))}%</td>
                      <td className="faint" style={{ textAlign: 'left' }}>
                        {band.sourceReference ?? '—'}
                        <div>from {formatDate(band.effectiveFrom)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
