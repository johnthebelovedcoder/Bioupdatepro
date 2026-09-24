import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { IconClipboard } from '@/components/icons';
import { AddTaxCodeForm, SetRateForm, ToggleTaxCodeButton } from '@/components/tax-code-forms';

export const metadata = { title: 'Tax codes — BioAssetPro' };

interface TaxCodeRow {
  id: string;
  code: string;
  name: string;
  taxType: 'VAT' | 'WHT';
  treatment: string;
  recoverable: boolean;
  whtCategory: string | null;
  active: boolean;
  currentRate: string | null;
  rates: Array<{
    id: string;
    rate: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    sourceReference: string | null;
  }>;
}

/** "0.07500000" → "7.5". */
function percent(rate: string | null): string | null {
  if (rate === null) return null;
  return String(Number((Number(rate) * 100).toFixed(4)));
}

/**
 * The tax codes documents are charged under, what each is charged at today,
 * and every rate each has ever had. When the law changes, the new rate is
 * added here from its start date — never typed over the old one.
 */
export default async function TaxCodesPage() {
  let codes: TaxCodeRow[] = [];
  let error: string | null = null;
  try {
    codes = await api<TaxCodeRow[]>('/tax/codes');
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not load the tax codes.';
  }
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Tax codes and rates"
        subtitle="What each code charges today, and every rate it has ever had"
        actions={
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            {!error ? <AddTaxCodeForm today={today} /> : null}
            <Link href="/ledger/tax" className="btn btn-ghost">
              Back to tax
            </Link>
          </div>
        }
      />

      <div className="stack">
        {error ? <div className="notice notice-error">{error}</div> : null}

        {!error && codes.length === 0 ? (
          <Card>
            <EmptyState
              icon={<IconClipboard size={22} />}
              title="No tax codes yet"
              body="Set up tax on the Tax page first — it adds the Nigerian VAT and withholding codes."
            />
          </Card>
        ) : null}

        {(['VAT', 'WHT'] as const).map((taxType) => {
          const rows = codes.filter((code) => code.taxType === taxType);
          if (rows.length === 0) return null;
          return (
            <Card
              key={taxType}
              title={taxType === 'VAT' ? 'VAT' : 'Withholding tax'}
              padded={false}
            >
              <div className="table-wrap">
                <table className="data wide">
                  <thead>
                    <tr>
                      <th style={{ width: 140 }}>Code</th>
                      <th>Name</th>
                      <th className="right" style={{ width: 90 }}>Today</th>
                      <th>History</th>
                      <th style={{ width: 200 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((code) => (
                      <tr key={code.id} style={code.active ? undefined : { opacity: 0.6 }}>
                        <td className="num strong" style={{ textAlign: 'left' }}>
                          {code.code}
                          {!code.active ? <div className="badge">inactive</div> : null}
                        </td>
                        <td style={{ textAlign: 'left' }}>
                          {code.name}
                          <div className="faint">
                            {taxType === 'VAT'
                              ? `${code.treatment.toLowerCase().replace(/_/g, ' ')} · input tax ${code.recoverable ? 'recoverable' : 'not recoverable'}`
                              : (code.whtCategory ?? '')}
                          </div>
                        </td>
                        <td className="num">
                          {code.currentRate !== null ? `${percent(code.currentRate)}%` : (
                            <span className="badge badge-warning">no rate</span>
                          )}
                        </td>
                        <td className="faint" style={{ textAlign: 'left', whiteSpace: 'normal', fontSize: 13 }}>
                          {code.rates.length === 0
                            ? '—'
                            : code.rates.map((rate) => (
                                <div key={rate.id} title={rate.sourceReference ?? undefined}>
                                  {percent(rate.rate)}% from {formatDate(rate.effectiveFrom)}
                                  {rate.effectiveTo ? ` to ${formatDate(rate.effectiveTo)}` : ''}
                                </div>
                              ))}
                        </td>
                        <td>
                          <div className="row" style={{ gap: 'var(--sp-1)' }}>
                            {code.active ? (
                              <SetRateForm
                                taxCodeId={code.id}
                                code={code.code}
                                currentRatePercent={percent(code.currentRate)}
                                today={today}
                              />
                            ) : null}
                            <ToggleTaxCodeButton taxCodeId={code.id} active={code.active} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
