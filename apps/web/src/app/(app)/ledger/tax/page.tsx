import Link from 'next/link';
import { getTaxCodes, getTaxPeriods, getTaxSetup, type TaxPeriod } from '@/lib/tax';
import { formatDate } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconClipboard } from '@/components/icons';
import {
  GenerateTaxPeriodsForm,
  TaxCalculatorForm,
  TaxIdentifiersForm,
  TaxSetupForm,
} from '@/components/tax-actions';

export const metadata = { title: 'Tax — BioAssetPro' };

/**
 * The tax filing calendar — every VAT and WHT period, what is due when, and
 * which returns have been closed and filed.
 *
 * Separate from Period close on purpose. A management close does not mean a
 * return was filed, and a return being due does not stop the books closing.
 */
export default async function TaxPage() {
  const [periods, taxCodes, setup] = await Promise.all([
    getTaxPeriods(),
    getTaxCodes(),
    getTaxSetup(),
  ]);
  // A company signed up through onboarding starts with no tax policy and no
  // tax codes; nothing on this page works until it has them.
  const needsSetup = setup.ok && !setup.data.configured;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Tax"
        subtitle="VAT and withholding-tax returns — registers, reconciliation, close and filing"
      />

      <Tabs />

      <div className="stack">
        {!periods.ok ? (
          <div className="notice notice-error">{periods.error}</div>
        ) : needsSetup ? (
          <Card
            title="Set up tax first"
            subtitle="This company has no tax policy or tax codes yet, so nothing carrying VAT or WHT can be calculated"
          >
            <TaxSetupForm />
          </Card>
        ) : (
          <>
            {setup.ok && setup.data.whtBasis ? (
              <p className="faint" style={{ fontSize: 13 }}>
                Withholding tax is worked out{' '}
                {setup.data.whtBasis === 'NET_OF_VAT' ? 'before VAT' : 'including VAT'}.{' '}
                {setup.data.whtBasisAuthority}
              </p>
            ) : null}
            {setup.ok && setup.data.configured ? (
              <TaxIdentifiersForm
                tin={setup.data.tin}
                vatRegistrationNumber={setup.data.vatRegistrationNumber}
              />
            ) : null}
            <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
              <GenerateTaxPeriodsForm defaultYear={new Date().getUTCFullYear()} />
              <TaxCalculatorForm taxCodes={taxCodes} />
              <Link href="/ledger/tax/codes" className="btn btn-ghost">
                Codes and rates
              </Link>
            </div>

            {periods.data.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<IconClipboard size={22} />}
                  title="No tax periods yet"
                  body="Set up a year above. Until a period covers a document's date, nothing carrying VAT or WHT can post — the engine refuses rather than inventing one."
                />
              </Card>
            ) : (
              (['VAT', 'WHT'] as const).map((taxType) => {
                const rows = periods.data.filter((period) => period.taxType === taxType);
                if (rows.length === 0) return null;
                return (
                  <PeriodTable
                    key={taxType}
                    title={taxType === 'VAT' ? 'VAT' : 'Withholding tax'}
                    rows={rows}
                    today={today}
                  />
                );
              })
            )}
          </>
        )}
      </div>
    </>
  );
}

function PeriodTable({ title, rows, today }: { title: string; rows: TaxPeriod[]; today: string }) {
  const overdue = rows.filter((row) => row.status !== 'FILED' && row.dueDate.slice(0, 10) < today);

  return (
    <Card
      title={title}
      subtitle={
        overdue.length > 0
          ? `${overdue.length} return${overdue.length === 1 ? '' : 's'} past due and not filed`
          : `${rows.length} period${rows.length === 1 ? '' : 's'}`
      }
      padded={false}
    >
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Period</th>
              <th style={{ width: 130 }}>Covers</th>
              <th style={{ width: 120 }}>Due</th>
              <th style={{ width: 130 }}>Status</th>
              <th style={{ width: 170 }}>Filing reference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const late = row.status !== 'FILED' && row.dueDate.slice(0, 10) < today;
              return (
                <tr key={row.id}>
                  <td className="strong" style={{ textAlign: 'left' }}>
                    <Link href={`/ledger/tax/${row.id}`}>{row.name}</Link>
                  </td>
                  <td className="num faint" style={{ textAlign: 'left' }}>
                    {formatDate(row.startDate)} – {formatDate(row.endDate)}
                  </td>
                  <td className="num" style={{ textAlign: 'left' }}>
                    {formatDate(row.dueDate)}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        row.status === 'FILED'
                          ? 'badge-success'
                          : late
                            ? 'badge-danger'
                            : row.status === 'CLOSED'
                              ? 'badge-warning'
                              : ''
                      }`}
                    >
                      {late ? `${row.status.toLowerCase()} · overdue` : row.status.toLowerCase()}
                    </span>
                  </td>
                  <td className="faint" style={{ textAlign: 'left' }}>
                    {row.filingReference ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
