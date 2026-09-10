import { getManualJournals, getRecurringJournals, getGlAccounts, getReasonCodes } from '@/lib/journals';
import { formatDate, formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconTag } from '@/components/icons';
import { CreateManualJournalForm } from '@/components/create-manual-journal-form';
import { CreateRecurringJournalForm } from '@/components/create-recurring-journal-form';
import { GenerateDueRecurringButton } from '@/components/generate-due-recurring-button';
import { SubmitJournalButton } from '@/components/submit-journal-button';
import { TableSearch } from '@/components/table-search';

export const metadata = { title: 'Journals — BioAssetPro' };

/**
 * §3's manual and recurring journals, with a real web door at last —
 * previously API-only, reachable only through .scratch scripts. Delete is
 * absent everywhere here on purpose (§3: "disabled entirely") — a posted
 * journal is reversed, never edited or removed.
 */
export default async function JournalsPage() {
  const [manual, recurring, accounts, reasonCodes] = await Promise.all([
    getManualJournals(),
    getRecurringJournals(),
    getGlAccounts(),
    getReasonCodes(),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="stack">
      <PageHeader title="Journals" subtitle="Manual entries and recurring templates for prepayments and accruals" />

      <Tabs />

      <TableSearch
        placeholder="Search journals"
        actions={<CreateManualJournalForm accounts={accounts} reasonCodes={reasonCodes} today={today} />}
      >
        <Card title="Manual journals" padded={false}>
          {manual.length === 0 ? (
            <EmptyState
              icon={<IconTag size={22} />}
              title="No manual journal yet"
              body="Raise one above — a general entry, an accrual or a prepayment."
            />
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th style={{ width: 140 }}>Reference</th>
                    <th style={{ width: 110 }}>Date</th>
                    <th>Narration</th>
                    <th style={{ width: 90 }}>Type</th>
                    <th className="right" style={{ width: 130 }}>
                      Amount
                    </th>
                    <th style={{ width: 130 }}>Status</th>
                    <th style={{ width: 110 }}>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {manual.map((j) => (
                    <tr key={j.id}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        {j.reference}
                        {j.reversalOf ? <div className="faint">reverses {j.reversalOf}</div> : null}
                        {j.reversedBy ? <div className="faint">reversed by {j.reversedBy}</div> : null}
                      </td>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {formatDate(j.journalDate)}
                      </td>
                      <td>
                        {j.narration}
                        <div className="faint">raised by {j.raisedBy}</div>
                      </td>
                      <td>{j.journalType}</td>
                      <td className="num">{formatNaira(j.totalDebitKobo)}</td>
                      <td>
                        <span
                          className={
                            j.status === 'POSTED'
                              ? 'badge badge-success'
                              : j.status === 'SUBMITTED' || j.status === 'UNDER_REVIEW'
                                ? 'badge badge-warning'
                                : 'badge'
                          }
                        >
                          {j.status.toLowerCase().replace('_', ' ')}
                        </span>
                      </td>
                      <td>
                        {j.status === 'DRAFT' || j.status === 'RETURNED' ? (
                          <SubmitJournalButton manualJournalId={j.id} />
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </TableSearch>

      <Card
        title="Recurring templates"
        padded={false}
        action={
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <CreateRecurringJournalForm accounts={accounts} today={today} />
            <GenerateDueRecurringButton />
          </div>
        }
      >
        {recurring.length === 0 ? (
          <EmptyState
            icon={<IconTag size={22} />}
            title="No recurring template yet"
            body="Create one for a prepayment or accrual that repeats every period."
          />
        ) : (
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>Code</th>
                  <th>Name</th>
                  <th style={{ width: 110 }}>Frequency</th>
                  <th style={{ width: 110 }}>Basis</th>
                  <th className="right" style={{ width: 130 }}>
                    Amount / run
                  </th>
                  <th style={{ width: 110 }}>Next due</th>
                  <th style={{ width: 80 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {recurring.map((t) => (
                  <tr key={t.id}>
                    <td className="num strong" style={{ textAlign: 'left' }}>
                      {t.code}
                    </td>
                    <td>
                      {t.name}
                      <div className="faint">{t.journalType}</div>
                    </td>
                    <td>{t.frequency.toLowerCase()}</td>
                    <td>{t.basis.toLowerCase().replace('_', ' ')}</td>
                    <td className="num">{formatNaira(t.amountKobo)}</td>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {formatDate(t.nextRunDate)}
                    </td>
                    <td>
                      <span className={t.active ? 'badge badge-success' : 'badge'}>
                        {t.active ? 'active' : 'ended'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <p className="muted" style={{ fontSize: 14 }}>
          Every manual journal is sent for approval on raising — nothing here posts by itself.
          A recurring template generates a fresh <strong>draft</strong> journal once its next
          run date arrives; that draft still needs its own approval, the same as any manual
          entry. Posted journals are never edited or deleted — only reversed.
        </p>
      </Card>
    </div>
  );
}
