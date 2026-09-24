import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  formatRate,
  getTaxPeriods,
  getTaxReconciliation,
  getVatRegister,
  getWhtRegister,
  type TaxReconciliation,
  type VatRegister,
  type WhtRegister,
} from '@/lib/tax';
import { formatDate, formatNaira, toKobo } from '@/lib/money';
import { Card, PageHeader, Stat } from '@/components/ui';
import { CloseTaxPeriodButton, FileTaxPeriodForm } from '@/components/tax-actions';

export const metadata = { title: 'Tax period — BioAssetPro' };

const STATUS_TONE: Record<string, string> = {
  OPEN: '',
  CLOSED: 'badge-warning',
  FILED: 'badge-success',
};

/**
 * One return: what the register says is owed, proof that it agrees with the
 * ledger, and the two terminal steps — close, then file.
 */
export default async function TaxPeriodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const periods = await getTaxPeriods();
  if (!periods.ok) {
    return (
      <>
        <PageHeader title="Tax period" />
        <div className="notice notice-error">{periods.error}</div>
      </>
    );
  }

  const period = periods.data.find((row) => row.id === id);
  if (!period) notFound();

  const [register, reconciliation] = await Promise.all([
    period.taxType === 'VAT' ? getVatRegister(id) : getWhtRegister(id),
    getTaxReconciliation(id),
  ]);

  return (
    <>
      <PageHeader
        title={`${period.taxType} — ${period.name}`}
        subtitle={`Covers ${formatDate(period.startDate)} – ${formatDate(period.endDate)} · due ${formatDate(period.dueDate)}`}
        actions={
          <Link href="/ledger/tax" className="btn btn-ghost">
            Back to tax
          </Link>
        }
      />

      <div className="stack">
        <Card title="Status">
          <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={`badge ${STATUS_TONE[period.status] ?? ''}`}>
              {period.status.toLowerCase()}
            </span>
            {period.status === 'FILED' ? (
              <span className="faint">
                Filed {formatDate(period.filedAt)}, reference{' '}
                <strong>{period.filingReference}</strong>
              </span>
            ) : null}
          </div>
        </Card>

        {!register.ok ? (
          <div className="notice notice-error">{register.error}</div>
        ) : period.taxType === 'VAT' ? (
          <VatSection register={register.data as VatRegister} />
        ) : (
          <WhtSection register={register.data as WhtRegister} />
        )}

        {!reconciliation.ok ? (
          <div className="notice notice-error">{reconciliation.error}</div>
        ) : (
          <ReconciliationCard reconciliation={reconciliation.data} />
        )}

        {period.status === 'OPEN' ? (
          <Card
            title="Close this period"
            subtitle="Stops further entries landing in this return"
          >
            <CloseTaxPeriodButton
              taxPeriodId={id}
              agrees={reconciliation.ok && reconciliation.data.agrees}
            />
          </Card>
        ) : null}

        {period.status === 'CLOSED' ? (
          <Card
            title="File this return"
            subtitle="Once submitted to the tax authority, record its reference here"
          >
            <FileTaxPeriodForm taxPeriodId={id} />
          </Card>
        ) : null}
      </div>
    </>
  );
}

function VatSection({ register }: { register: VatRegister }) {
  const net = toKobo(register.summary.netPayableKobo);
  return (
    <>
      <div className="stat-grid">
        <Stat label="Output VAT" value={formatNaira(register.summary.outputTaxKobo)} money />
        <Stat
          label="Recoverable input VAT"
          value={formatNaira(register.summary.inputTaxRecoverableKobo)}
          money
        />
        <Stat
          label={net >= 0n ? 'Payable to the authority' : 'Credit carried forward'}
          value={formatNaira(net >= 0n ? net : -net)}
          money
        />
        <Stat
          label="Irrecoverable input VAT"
          value={formatNaira(register.summary.inputTaxIrrecoverableKobo)}
          money
          hint="Paid on exempt supplies — a cost, not a credit"
        />
      </div>

      <Card
        title="Register"
        subtitle={`${register.entries.length} entr${register.entries.length === 1 ? 'y' : 'ies'} · turnover ${formatNaira(register.summary.outputTurnoverKobo)} · purchases ${formatNaira(register.summary.inputPurchasesKobo)}`}
        padded={false}
      >
        {register.entries.length === 0 ? (
          <p className="faint" style={{ padding: 'var(--sp-5)' }}>
            Nothing carrying VAT has posted in this period.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Date</th>
                  <th>Document</th>
                  <th>Counterparty</th>
                  <th style={{ width: 90 }}>Direction</th>
                  <th style={{ width: 120 }}>Code</th>
                  <th className="right" style={{ width: 80 }}>Rate</th>
                  <th className="right" style={{ width: 130 }}>Base</th>
                  <th className="right" style={{ width: 120 }}>VAT</th>
                </tr>
              </thead>
              <tbody>
                {register.entries.map((entry, index) => (
                  <tr key={`${entry.documentReference}-${index}`}>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {formatDate(entry.documentDate)}
                    </td>
                    <td style={{ textAlign: 'left' }}>
                      {entry.journalEntryId ? (
                        <Link href={`/ledger/journals?search=${encodeURIComponent(entry.documentReference)}`}>
                          {entry.documentReference}
                        </Link>
                      ) : (
                        entry.documentReference
                      )}
                    </td>
                    <td style={{ textAlign: 'left' }}>
                      {entry.counterparty ?? '—'}
                      {entry.counterpartyTin ? (
                        <div className="faint">TIN {entry.counterpartyTin}</div>
                      ) : null}
                    </td>
                    <td>{entry.direction.toLowerCase()}</td>
                    <td className="faint">
                      {entry.taxCode}
                      {entry.direction === 'INPUT' && !entry.recoverable ? (
                        <div>not recoverable</div>
                      ) : null}
                    </td>
                    <td className="num">{formatRate(entry.appliedRate)}</td>
                    <td className="num">{formatNaira(entry.taxableBaseKobo)}</td>
                    <td className="num">{formatNaira(entry.taxKobo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function WhtSection({ register }: { register: WhtRegister }) {
  return (
    <>
      <div className="stat-grid">
        <Stat
          label="Withheld — to remit"
          value={formatNaira(register.summary.payableKobo)}
          money
          hint="Deducted from suppliers, owed to the authority"
        />
        <Stat
          label="Withheld from us"
          value={formatNaira(register.summary.receivableKobo)}
          money
          hint="Deducted by customers — a credit against our own tax"
        />
      </div>

      {register.summary.receivableWithoutCreditNote > 0 ? (
        <div className="notice notice-warning">
          {register.summary.receivableWithoutCreditNote} amount
          {register.summary.receivableWithoutCreditNote === 1 ? '' : 's'} withheld from us{' '}
          {register.summary.receivableWithoutCreditNote === 1 ? 'has' : 'have'} no credit note yet.
          Without one the credit cannot be claimed, so{' '}
          {register.summary.receivableWithoutCreditNote === 1 ? 'it is' : 'they are'} not counted
          as claimable.
        </div>
      ) : null}

      {register.summary.payableByCategory.length > 0 ? (
        <Card title="To remit, by category" padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="right" style={{ width: 160 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {register.summary.payableByCategory.map((row) => (
                  <tr key={row.category}>
                    <td style={{ textAlign: 'left' }}>{row.category.toLowerCase().replace(/_/g, ' ')}</td>
                    <td className="num">{formatNaira(row.amountKobo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card
        title="Register"
        subtitle={`${register.entries.length} entr${register.entries.length === 1 ? 'y' : 'ies'}`}
        padded={false}
      >
        {register.entries.length === 0 ? (
          <p className="faint" style={{ padding: 'var(--sp-5)' }}>
            Nothing carrying withholding tax has posted in this period.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Date</th>
                  <th>Document</th>
                  <th>Counterparty</th>
                  <th style={{ width: 100 }}>Direction</th>
                  <th style={{ width: 140 }}>Category</th>
                  <th className="right" style={{ width: 80 }}>Rate</th>
                  <th className="right" style={{ width: 130 }}>Base</th>
                  <th className="right" style={{ width: 120 }}>WHT</th>
                  <th style={{ width: 130 }}>Credit note</th>
                </tr>
              </thead>
              <tbody>
                {register.entries.map((entry, index) => (
                  <tr key={`${entry.documentReference}-${index}`}>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {formatDate(entry.documentDate)}
                    </td>
                    <td style={{ textAlign: 'left' }}>{entry.documentReference}</td>
                    <td style={{ textAlign: 'left' }}>
                      {entry.counterparty ?? '—'}
                      {entry.counterpartyTin ? (
                        <div className="faint">TIN {entry.counterpartyTin}</div>
                      ) : null}
                    </td>
                    <td>{entry.direction.toLowerCase()}</td>
                    <td className="faint">{entry.whtCategory.toLowerCase().replace(/_/g, ' ')}</td>
                    <td className="num">{formatRate(entry.appliedRate)}</td>
                    <td className="num">{formatNaira(entry.taxableBaseKobo)}</td>
                    <td className="num">{formatNaira(entry.taxKobo)}</td>
                    <td className="faint">
                      {entry.direction === 'RECEIVABLE' ? (entry.creditNoteReference ?? 'missing') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function ReconciliationCard({ reconciliation }: { reconciliation: TaxReconciliation }) {
  return (
    <Card
      title="Reconciliation"
      subtitle={
        reconciliation.lines.length === 0
          ? 'Nothing to reconcile yet'
          : reconciliation.agrees
            ? 'The register agrees with the ledger, to the kobo'
            : 'The register and the ledger disagree'
      }
      padded={false}
    >
      {reconciliation.lines.length === 0 ? (
        <p className="faint" style={{ padding: 'var(--sp-5)' }}>
          No register entries in this period, so there is nothing for the ledger to disagree with.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data wide">
            <thead>
              <tr>
                <th>Control account</th>
                <th style={{ width: 100 }}>Direction</th>
                <th className="right" style={{ width: 140 }}>Register</th>
                <th className="right" style={{ width: 140 }}>Ledger</th>
                <th className="right" style={{ width: 140 }}>Difference</th>
                <th style={{ width: 100 }}>Result</th>
              </tr>
            </thead>
            <tbody>
              {reconciliation.lines.map((line) => (
                <tr key={`${line.glAccountNumber}-${line.direction}`}>
                  <td style={{ textAlign: 'left' }}>
                    <span className="num">{line.glAccountNumber}</span> {line.glAccountName}
                  </td>
                  <td>{line.direction.toLowerCase()}</td>
                  <td className="num">{formatNaira(line.registerTaxKobo)}</td>
                  <td className="num">{formatNaira(line.ledgerBalanceKobo)}</td>
                  <td className="num">{formatNaira(line.differenceKobo)}</td>
                  <td>
                    <span className={`badge ${line.agrees ? 'badge-success' : 'badge-danger'}`}>
                      {line.agrees ? 'agrees' : 'differs'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
