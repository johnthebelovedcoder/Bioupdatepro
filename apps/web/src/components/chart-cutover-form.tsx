'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui';
import { formatNaira } from '@/lib/money';
import type { CutoverPreview, ProductClass, StockClass } from '@/lib/controls';
import { previewCutover, runCutover, type CutoverChoices } from '@/app/(app)/ledger/chart/actions';

const STOCK: Array<[StockClass, string]> = [['RAW', 'Raw material (12000)'], ['FEED', 'Feed (12100)'], ['PACKAGING', 'Packaging (12200)'], ['CONSUMABLE', 'Consumable (12300)']];

/**
 * Choose what each item is, see where every balance goes, give Finance's
 * approval, then run. A choice asks the API for the moves again rather than
 * working them out here, so what is shown is exactly what the run will do.
 */
export function ChartCutoverForm({ initial }: { initial: CutoverPreview }) {
  const [preview, setPreview] = useState(initial);
  const [choices, setChoices] = useState<CutoverChoices>({
    cutover: initial.cutoverDate!,
    itemClasses: Object.fromEntries(initial.items.filter((i) => i.productClass).map((i) => [i.itemId, i.productClass!])),
    stockClasses: Object.fromEntries(initial.items.filter((i) => i.stockClass).map((i) => [i.itemId, i.stockClass!])),
    defaultClass: 'LIVE_POULTRY',
    defaultSpecies: 'poultry',
    overrides: {},
  });
  const [approvedBy, setApprovedBy] = useState('');
  const [reference, setReference] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const classes = Object.entries(preview.classes) as Array<[ProductClass, CutoverPreview['classes'][ProductClass]]>;
  const approved = approvedBy.trim() !== '' && reference.trim() !== '';

  const refresh = (next: CutoverChoices) => {
    setChoices(next);
    setConfirmed(false);
    startTransition(async () => {
      const outcome = await previewCutover(next);
      setError(outcome.error);
      if (outcome.preview) setPreview(outcome.preview);
    });
  };

  const run = () =>
    startTransition(async () => {
      const outcome = await runCutover(choices, { approvedBy, approvalReference: reference });
      setError(outcome.error);
      setMessage(outcome.message);
      // The form disappears once the company is on the approved chart, so carry
      // the outcome to the page rather than leaving it in state that unmounts.
      if (!outcome.error) router.push(`/ledger/chart?done=${encodeURIComponent(outcome.message ?? 'Moved to the approved chart.')}`);
    });

  return (
    <>
      <Card title="Cutover" subtitle={`Balances as they stand at the end of ${dayBefore(preview.cutoverDate!)} move on ${preview.cutoverDate}`}>
        <div className="stack" style={{ gap: 'var(--sp-3)', fontSize: 14 }}>
          <p>
            One journal per branch, dated the cutover, moves every balance on the old accounts to its approved account. Each line
            keeps its farm, pen, customer, supplier and item. Poultry rearing cost goes to the immature or mature account by each
            cohort&apos;s stage. Settings are then pointed at the approved accounts, the old accounts are retired, and everything
            after posts to the five-digit chart. It all happens together or not at all.
          </p>
          <label className="field" style={{ maxWidth: 220 }}>
            <span>Cutover (first day of an open month)</span>
            <input type="date" value={choices.cutover} onChange={(event) => event.target.value && refresh({ ...choices, cutover: event.target.value })} />
          </label>
          {preview.cutoverDate! > new Date().toISOString().slice(0, 10) ? (
            <div className="notice notice-info">
              The company switches to the approved chart as soon as this runs, but the old balances move on {preview.cutoverDate}.
              Until then, anything posted already goes to approved accounts, and the cutover journal moves only what is on the
              old accounts. Reports stay consistent; pick the first day of the current month if you would rather the two happen together.
            </div>
          ) : null}
        </div>
      </Card>

      {preview.blockers.length > 0 ? (
        <div className="notice notice-error">
          <strong>Cannot run yet.</strong>
          <ul style={{ margin: 'var(--sp-2) 0 0 var(--sp-4)' }}>{preview.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      ) : null}
      {preview.warnings.length > 0 ? (
        <div className="notice notice-warning">
          <ul style={{ margin: '0 0 0 var(--sp-4)' }}>{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      ) : null}

      {preview.items.length > 0 ? (
        <Card title="What each item is" subtitle="Decides its stock, revenue and cost-of-sales accounts. Guessed from the name — check each one." padded={false}>
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th>Item</th>
                  <th style={{ width: 240 }}>Is</th>
                  <th style={{ width: 260 }}>Posts to</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((item) => {
                  const product = item.productClass ? (choices.itemClasses[item.itemId] ?? item.productClass) : null;
                  const stock = item.stockClass ? (choices.stockClasses[item.itemId] ?? item.stockClass) : null;
                  return (
                    <tr key={item.itemId}>
                      <td style={{ textAlign: 'left' }}>
                        {item.code} <span className="faint">{item.description}</span>
                        {item.productClass && item.proposedProduct === null ? <span className="badge badge-warning" style={{ marginLeft: 8 }}>not guessed</span> : null}
                      </td>
                      <td>
                        {product ? (
                          <select
                            value={product}
                            disabled={pending}
                            onChange={(event) => refresh({ ...choices, itemClasses: { ...choices.itemClasses, [item.itemId]: event.target.value as ProductClass } })}
                          >
                            {classes.map(([key, c]) => <option key={key} value={key}>{c.label}</option>)}
                          </select>
                        ) : (
                          <select
                            value={stock!}
                            disabled={pending}
                            onChange={(event) => refresh({ ...choices, stockClasses: { ...choices.stockClasses, [item.itemId]: event.target.value as StockClass } })}
                          >
                            {STOCK.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="faint">{product ? `${preview.classes[product].revenue} / ${preview.classes[product].costOfSales} / ${preview.classes[product].inventory}` : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card title="When it cannot be told" subtitle="For sales lines with no item, and losses in a pen with no single species">
        <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
          <label className="field">
            <span>Sales default to</span>
            <select value={choices.defaultClass} disabled={pending} onChange={(event) => refresh({ ...choices, defaultClass: event.target.value as ProductClass })}>
              {classes.map(([key, c]) => <option key={key} value={key}>{c.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Species defaults to</span>
            <select value={choices.defaultSpecies} disabled={pending} onChange={(event) => refresh({ ...choices, defaultSpecies: event.target.value as 'poultry' | 'snail' })}>
              <option value="poultry">Poultry</option>
              <option value="snail">Snails</option>
            </select>
          </label>
        </div>
      </Card>

      {preview.cohorts.length > 0 ? (
        <Card title="Poultry cohorts" subtitle="Each cohort's earlier rearing cost is restated into the account of its stage today" padded={false}>
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr><th>Cohort</th><th>Stage</th><th style={{ width: 90 }}>Account</th><th className="right" style={{ width: 150 }}>Cost carried</th></tr>
              </thead>
              <tbody>
                {preview.cohorts.map((c) => (
                  <tr key={c.groupId}>
                    <td style={{ textAlign: 'left' }}>{c.code}</td>
                    <td>{c.stage}</td>
                    <td>{c.account}</td>
                    <td className="num">{formatNaira(c.rearingCostKobo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card title="Where every balance goes" subtitle={pending ? 'Working it out…' : `${preview.accounts.length} old accounts hold a balance; ${preview.retiring} will be retired`} padded={false}>
        {preview.accounts.length === 0 ? (
          <p className="faint" style={{ padding: 'var(--sp-5)' }}>Nothing on the old accounts. Running will only update the settings.</p>
        ) : (
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th>From</th>
                  <th className="right" style={{ width: 150 }}>Balance</th>
                  <th style={{ width: 90 }}>To</th>
                  <th className="right" style={{ width: 150 }}>Amount</th>
                  <th>Because</th>
                </tr>
              </thead>
              <tbody>
                {preview.accounts.flatMap((account) =>
                  account.moves.map((move, index) => (
                    <tr key={`${account.from}-${move.to}-${move.basis}`}>
                      <td style={{ textAlign: 'left' }}>{index === 0 ? <>{account.from} <span className="faint">{account.name}</span></> : null}</td>
                      <td className="num">{index === 0 ? formatNaira(account.balanceKobo) : null}</td>
                      <td>{move.to}</td>
                      <td className="num">{formatNaira(move.amountKobo)}</td>
                      <td className="faint" style={{ textAlign: 'left' }}>
                        {move.basis}
                        {move.assumed ? <span className="badge badge-warning" style={{ marginLeft: 8 }}>assumed</span> : null}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="faint" style={{ padding: 'var(--sp-3) var(--sp-4)', fontSize: 13 }}>Debit balances show as positive, credit balances in brackets.</p>
      </Card>

      <Card title="Run the move" subtitle="Finance has not signed off the crosswalk in the repository; record who did">
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
            <label className="field">
              <span>Crosswalk approved by</span>
              <input value={approvedBy} onChange={(event) => { setApprovedBy(event.target.value); setConfirmed(false); }} />
            </label>
            <label className="field">
              <span>Approval reference</span>
              <input value={reference} onChange={(event) => { setReference(event.target.value); setConfirmed(false); }} />
            </label>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14 }}>
            <input type="checkbox" checked={confirmed} disabled={!preview.canRun || !approved || pending} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>I have checked where every balance goes and what each item is. This cannot be undone from here.</span>
          </label>
          <div>
            <button type="button" className="btn btn-primary" disabled={!preview.canRun || !approved || !confirmed || pending} onClick={run}>
              {pending ? 'Working…' : `Move to the approved chart on ${preview.cutoverDate}`}
            </button>
          </div>
          {error ? <div className="notice notice-error">{error}</div> : null}
          {message ? <div className="notice notice-success">{message}</div> : null}
        </div>
      </Card>
    </>
  );
}

function dayBefore(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
