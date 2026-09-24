import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPayslip } from '@/lib/payroll-runs';
import { formatDate, formatNaira } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import { PrintButton } from '@/components/print-button';

export const metadata = { title: 'Payslip — BioAssetPro' };

/**
 * One employee's payslip for one run — what they earned, what was deducted
 * and why, and what the farm paid on top. Printable as it stands.
 */
export default async function PayslipPage({
  params,
}: {
  params: Promise<{ id: string; employeeId: string }>;
}) {
  const { id, employeeId } = await params;
  const slip = await getPayslip(id, employeeId);
  if (!slip) notFound();

  return (
    <>
      <PageHeader
        title={`Payslip — ${slip.name}`}
        subtitle={`${slip.employeeNumber} · ${slip.run} · ${formatDate(slip.payrollDate)}`}
        actions={
          <div className="row no-print" style={{ gap: 'var(--sp-2)' }}>
            <PrintButton />
            <Link href={`/finance/payroll/runs/${id}`} className="btn btn-ghost">
              Back to run
            </Link>
          </div>
        }
      />

      <div className="stack">
        <Card title="Earnings and deductions" padded={false}>
          <div className="table-wrap">
            <table className="data">
              <tbody>
                <Row label="Gross pay" value={slip.grossKobo} strong />
                <Row label="PAYE" value={slip.payeKobo} minus />
                <Row label="Pension (employee)" value={slip.employeePensionKobo} minus />
                <Row label="National Housing Fund" value={slip.nhfKobo} minus />
                <Row label="Net pay" value={slip.netPayKobo} strong />
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="Paid by the farm on top"
          subtitle="Not deducted from pay — shown so the full cost of this role is visible"
          padded={false}
        >
          <div className="table-wrap">
            <table className="data">
              <tbody>
                <Row label="Pension (employer)" value={slip.employerPensionKobo} />
                <Row label="NSITF" value={slip.nsitfKobo} />
                <Row label="ITF" value={slip.itfKobo} />
              </tbody>
            </table>
          </div>
        </Card>

        <p className="faint" style={{ fontSize: 13 }}>
          Calculated under rule set {slip.ruleVersion ?? '—'}.
          {slip.minimumWageExempt
            ? ' Exempt from PAYE: pay is at or below the national minimum wage.'
            : ''}
        </p>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  minus,
  strong,
}: {
  label: string;
  value: string;
  minus?: boolean;
  strong?: boolean;
}) {
  return (
    <tr>
      <td style={{ textAlign: 'left', fontWeight: strong ? 600 : undefined }}>{label}</td>
      <td className="num" style={{ width: 180, fontWeight: strong ? 600 : undefined }}>
        {minus ? '− ' : ''}
        {formatNaira(value)}
      </td>
    </tr>
  );
}
