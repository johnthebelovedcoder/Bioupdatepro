'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui';
import { formatNaira } from '@/lib/money';
import type { ProductClass, UnificationPreview } from '@/lib/controls';
import { previewUnification, runUnification, type UnificationChoices } from '@/app/(app)/ledger/chart/actions';

/**
 * Choose what each sold item is, see where every balance goes, then run.
 *
 * Changing a choice asks the API for the moves again rather than working them
 * out here, so what is shown is exactly what the run will do.
 */
export function ChartUnificationForm({ initial }: { initial: UnificationPreview }) {
  const [preview, setPreview] = useState(initial);
  const [choices, setChoices] = useState<UnificationChoices>({
    cutover: initial.cutoverDate!,
    itemClasses: Object.fromEntries(initial.items.map((item) => [item.itemId, item.chosen])),
    defaultClass: 'LIVE_POULTRY',
    defaultSpecies: 'poultry',
  });
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const classes = Object.entries(preview.classes) as Array<[ProductClass, UnificationPreview['classes'][ProductClass]]>;

  const refresh = (next: UnificationChoices) => {
    setChoices(next);
    setConfirmed(false);
    startTransition(async () => {
      const outcome = await previewUnification(next);
      setError(outcome.error);
      if (outcome.preview) setPreview(outcome.preview);
    });
  };

  const run = () =>
    startTransition(async () => {
      const outcome = await runUnification(choices);
      setError(outcome.error);
      setMessage(outcome.message);
      if (!outcome.error) router.refresh();
    });

  return (
    <>
      <Card title="Cutover" subtitle={`Balances as they stand at the end of ${dayBefore(preview.cutoverDate!)} move on ${preview.cutoverDate}`}>
        <div className="stack" style={{ gap: 'var(--sp-3)', fontSize: 14 }}>
          <p>
            One journal per branch, dated the cutover, moves every balance on the old accounts to its new account. Each line
            keeps its farm, pen, customer, supplier and item. Items, sales and purchasing settings, salary components, bank
            accounts and tax mappings are then pointed at the new accounts, the old accounts are retired, and everything
            after posts to the six-digit chart. It all happens together or not at all.
          </p>
          <label className="field" style={{ maxWidth: 220 }}>
            <span>Cutover (first day of an open month)</span>
            <input
              type="date"
              value={choices.cutover}
              onChange={(event) => event.target.value && refresh({ ...choices, cutover: event.target.value })}
            />
          </label>
        </div>
      </Card>

      {preview.blockers.length > 0 ? (
        <div className="notice notice-error">
          <strong>Cannot run yet.</strong>
          <ul style={{ margin: 'var(--sp-2) 0 0 var(--sp-4)' }}>
            {preview.blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
        </div>
      ) : null}
      {preview.warnings.length > 0 ? (
        <div className="notice notice-warning">
          <ul style={{ margin: '0 0 0 var(--sp-4)' }}>
            {preview.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      ) : null}

      {preview.items.length > 0 ? (
        <Card title="What each item is" subtitle="Decides its revenue, cost-of-sales and store accounts. Guessed from the name — check each one." padded={false}>
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
                  const chosen = choices.itemClasses[item.itemId] ?? item.chosen;
                  const accounts = preview.classes[chosen];
                  return (
                    <tr key={item.itemId}>
                      <td style={{ textAlign: 'left' }}>
                        {item.code} <span className="faint">{item.description}</span>
                        {item.proposed === null ? <span className="badge badge-warning" style={{ marginLeft: 8 }}>not guessed</span> : null}
                      </td>
                      <td>
                        <select
                          value={chosen}
                          disabled={pending}
                          onChange={(event) =>
                            refresh({ ...choices, itemClasses: { ...choices.itemClasses, [item.itemId]: event.target.value as ProductClass } })
                          }
                        >
                          {classes.map(([key, c]) => <option key={key} value={key}>{c.label}</option>)}
                        </select>
                      </td>
                      <td className="faint">{`${accounts.revenue} / ${accounts.costOfSales} / ${accounts.inventory}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card title="When it cannot be told" subtitle="For sales lines with no item, and rearing cost or losses in a pen with no single species">
        <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
          <label className="field">
            <span>Sales default to</span>
            <select value={choices.defaultClass} disabled={pending} onChange={(event) => refresh({ ...choices, defaultClass: event.target.value as ProductClass })}>
              {classes.map(([key, c]) => <option key={key} value={key}>{c.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Species defaults to</span>
            <select
              value={choices.defaultSpecies}
              disabled={pending}
              onChange={(event) => refresh({ ...choices, defaultSpecies: event.target.value as 'poultry' | 'snail' })}
            >
              <option value="poultry">Poultry</option>
              <option value="snail">Snails</option>
            </select>
          </label>
        </div>
      </Card>

      <Card title="Where every balance goes" subtitle={pending ? 'Working it out…' : `${preview.accounts.length} old accounts hold a balance`} padded={false}>
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
        <p className="faint" style={{ padding: 'var(--sp-3) var(--sp-4)', fontSize: 13 }}>
          Debit balances show as positive, credit balances in brackets.
        </p>
      </Card>

      {preview.untouched.length > 0 ? (
        <Card title="Left as they are" subtitle="Accounts on neither chart keep their balances" padded={false}>
          <div className="table-wrap">
            <table className="data wide">
              <tbody>
                {preview.untouched.map((a) => (
                  <tr key={a.accountNumber}>
                    <td style={{ textAlign: 'left' }}>{a.accountNumber} <span className="faint">{a.name}</span></td>
                    <td className="num" style={{ width: 150 }}>{formatNaira(a.balanceKobo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card title="Run the move">
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14 }}>
            <input type="checkbox" checked={confirmed} disabled={!preview.canRun || pending} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>I have checked where every balance goes and what each item is. This cannot be undone from here.</span>
          </label>
          <div>
            <button type="button" className="btn btn-primary" disabled={!preview.canRun || !confirmed || pending} onClick={run}>
              {pending ? 'Working…' : `Move to the six-digit chart on ${preview.cutoverDate}`}
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
