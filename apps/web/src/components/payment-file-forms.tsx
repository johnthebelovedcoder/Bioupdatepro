'use client';

import { useState, useTransition } from 'react';
import { downloadPaymentFile, issuePaymentFile } from '@/app/(app)/finance/payment-files/actions';
import { formatNaira } from '@/lib/money';

export interface PendingPayment {
  id: string;
  paymentNumber: string;
  paymentDate: string;
  payee: string;
  amountKobo: string;
  rows: number;
  problem: string | null;
}

function save(reference: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${reference}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Choose posted transfers and issue them as one bank file. */
export function IssuePaymentFile({ kind, payments }: { kind: 'SUPPLIER' | 'SALARY'; payments: PendingPayment[] }) {
  const ready = payments.filter((p) => !p.problem);
  const [chosen, setChosen] = useState<string[]>(ready.map((p) => p.id));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const total = payments.filter((p) => chosen.includes(p.id)).reduce((s, p) => s + BigInt(p.amountKobo), 0n);

  const issue = () =>
    start(async () => {
      setError(null);
      const result = await issuePaymentFile(kind, chosen);
      if (result.error || !result.csv || !result.reference) {
        setError(result.error ?? 'Could not issue that file.');
        return;
      }
      save(result.reference, result.csv);
      setIssued(`${result.reference} issued and downloaded. SHA-256 ${result.sha256?.slice(0, 16)}…`);
    });

  if (issued) return <div className="notice notice-success">{issued}</div>;
  if (payments.length === 0) return <p className="faint" style={{ margin: 0 }}>No posted bank transfers waiting for a file.</p>;
  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      {error ? <div className="notice notice-error">{error}</div> : null}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 40 }} />
              <th>Payment</th>
              <th>Paid to</th>
              <th className="right">Rows</th>
              <th className="right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td>
                  <input
                    type="checkbox"
                    disabled={!!p.problem}
                    checked={chosen.includes(p.id)}
                    onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p.id] : c.filter((x) => x !== p.id)))}
                    aria-label={`Include ${p.paymentNumber}`}
                  />
                </td>
                <td className="num" style={{ textAlign: 'left' }}>
                  {p.paymentNumber}
                  <div className="faint">{p.paymentDate}</div>
                </td>
                <td>
                  {p.payee}
                  {p.problem ? <div className="notice notice-error" style={{ marginTop: 4 }}>{p.problem}</div> : null}
                </td>
                <td className="num right">{p.rows}</td>
                <td className="num right">{formatNaira(p.amountKobo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'center' }}>
        <button type="button" className="btn btn-primary" disabled={pending || chosen.length === 0} onClick={issue}>
          {pending ? 'Issuing…' : `Issue file — ${formatNaira(total.toString())}`}
        </button>
        <span className="faint">Each payment goes in one file only. The file carries full account numbers; keep it safe.</span>
      </div>
    </div>
  );
}

export function DownloadPaymentFile({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const run = () =>
    start(async () => {
      const result = await downloadPaymentFile(id);
      if (result.error || !result.csv || !result.reference) {
        setNote(result.error ?? 'Could not download it.');
        return;
      }
      save(result.reference, result.csv);
      setNote(result.matchesIssued ? null : 'Bank details have changed since this file was issued; check it before sending.');
    });
  return (
    <span className="stack" style={{ gap: 4 }}>
      <button type="button" className="btn btn-sm" disabled={pending} onClick={run}>
        {pending ? 'Preparing…' : 'Download again'}
      </button>
      {note ? <span className="notice notice-warning">{note}</span> : null}
    </span>
  );
}
