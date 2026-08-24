'use client';

import { useMemo, useState } from 'react';
import type { Product } from '@/lib/demo-products';
import { VAT_LABELS } from '@/lib/demo-products';
import type { BatchSummary } from '@/lib/demo';
import type { Customer } from '@/lib/demo-trade';
import { formatNaira, parseNairaToKobo, toKobo } from '@/lib/money';
import { enqueue, flush } from '@/lib/sync-queue';
import { Card, PageHeader } from './ui';
import { Sheet } from './sheet';

/**
 * Recording a sale.
 *
 * The single largest hole in the product until now: feed going out was
 * recordable and money coming in was not, which for something whose pitch is
 * "am I making money" is the wrong way round.
 *
 * Three things make this more than a form:
 *
 *   1. Selling livestock TAKES ANIMALS OUT OF A BATCH. Five hundred broilers
 *      sold is five hundred birds gone and their share of that batch's
 *      accumulated cost leaving with them. That is the entry that makes batch
 *      profit provable rather than approximate, and it is why the batch picker
 *      appears the moment a live product has a quantity.
 *
 *   2. THE PRICE IS EDITABLE. Farm-gate prices move weekly and get haggled at
 *      the gate. A system that will not let the seller change the price gets a
 *      made-up figure typed into it, or gets bypassed for a paper receipt.
 *
 *   3. IT WORKS AT THE GATE. Cash sale to someone with no customer record, on a
 *      phone, with no signal — because that is where a great deal of a Nigerian
 *      farm's income actually happens, and income that cannot be recorded where
 *      it happens does not get recorded.
 */

interface Line {
  productId: string;
  quantity: number;
  /** Kobo per unit. Starts at the product's default, then whatever was agreed. */
  priceKobo: string;
  /** Which population the animals leave, for live products. */
  batchId?: string;
}

export function RecordSale({
  products,
  customers,
  batches,
  today,
  allowWalkIn,
  defaultTermsDays,
  creditLimitKobo,
}: {
  products: Product[];
  customers: Customer[];
  batches: BatchSummary[];
  today: string;
  allowWalkIn: boolean;
  defaultTermsDays: number;
  creditLimitKobo: string;
}) {
  const [date, setDate] = useState(today);
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [buyerKind, setBuyerKind] = useState<'customer' | 'walkIn'>(
    allowWalkIn ? 'walkIn' : 'customer',
  );
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? '');
  const [walkInName, setWalkInName] = useState('');
  const [paidNow, setPaidNow] = useState(true);
  const [method, setMethod] = useState('Cash');
  const [reviewing, setReviewing] = useState(false);
  const [queued, setQueued] = useState(false);

  function lineFor(product: Product): Line {
    return (
      lines[product.id] ?? {
        productId: product.id,
        quantity: 0,
        priceKobo: product.defaultPriceKobo,
      }
    );
  }

  function update(product: Product, change: Partial<Line>) {
    setLines((current) => ({
      ...current,
      [product.id]: { ...lineFor(product), ...change },
    }));
  }

  const sold = useMemo(
    () =>
      products
        .map((product) => ({ product, line: lines[product.id] }))
        .filter((entry): entry is { product: Product; line: Line } =>
          Boolean(entry.line && entry.line.quantity > 0),
        ),
    [products, lines],
  );

  const total = sold.reduce(
    (sum, { line }) => sum + toKobo(line.priceKobo) * BigInt(line.quantity),
    0n,
  );

  // Everything a farm sells here is zero-rated, so this is ₦0 today. It is
  // computed rather than assumed because the moment a farm sells something
  // standard-rated — processed or packaged goods — it stops being ₦0.
  const vat = sold.reduce((sum, { product, line }) => {
    if (product.vat !== 'STANDARD') return sum;
    const net = toKobo(line.priceKobo) * BigInt(line.quantity);
    return sum + (net * 75n) / 1000n;
  }, 0n);

  const customer = customers.find((entry) => entry.id === customerId);
  const buyerName = buyerKind === 'walkIn' ? walkInName.trim() : (customer?.name ?? '');

  /** Problems that must be fixed before this can be recorded. */
  const problems: string[] = [];
  if (sold.length === 0) problems.push('Add at least one thing being sold');
  if (!buyerName) {
    problems.push(buyerKind === 'walkIn' ? "Enter the buyer's name" : 'Choose a customer');
  }
  for (const { product, line } of sold) {
    if (toKobo(line.priceKobo) <= 0n) {
      problems.push(`Set a price for ${product.name}`);
    }
    if (product.fromPopulation) {
      if (!line.batchId) {
        problems.push(`Choose which population the ${product.name.toLowerCase()} came from`);
        continue;
      }
      const batch = batches.find((entry) => entry.id === line.batchId);
      const animals = line.quantity * (product.animalsPerUnit ?? 1);
      if (batch && animals > batch.population) {
        problems.push(
          `${batch.code} has ${batch.population.toLocaleString('en-NG')} left — cannot sell ${animals.toLocaleString('en-NG')}`,
        );
      }
    }
  }

  /** Not a blocker — a judgement call for the person selling. */
  const overLimit =
    !paidNow &&
    customer &&
    toKobo(customer.balanceKobo) + total > toKobo(creditLimitKobo);

  function submit() {
    enqueue({
      kind: 'sale',
      label: `Sale to ${buyerName} · ${formatNaira(total)}`,
      payload: {
        type: 'sale',
        date,
        buyer: buyerKind === 'walkIn' ? { walkIn: buyerName } : { customerId },
        paidNow,
        method: paidNow ? method : null,
        termsDays: paidNow ? 0 : defaultTermsDays,
        lines: sold.map(({ product, line }) => ({
          productId: product.id,
          code: product.code,
          quantity: line.quantity,
          unitPriceKobo: line.priceKobo,
          vat: product.vat,
          batchId: line.batchId ?? null,
          animalsRemoved: product.fromPopulation
            ? line.quantity * (product.animalsPerUnit ?? 1)
            : 0,
        })),
        totalKobo: total.toString(),
        vatKobo: vat.toString(),
      },
    });
    void flush();
    setReviewing(false);
    setQueued(true);
  }

  if (queued) {
    return (
      <>
        <PageHeader title="Sale recorded" subtitle={`${buyerName} · ${formatNaira(total)}`} />
        <Card>
          <div className="stack" style={{ gap: 'var(--sp-4)' }}>
            <div className="notice notice-info">
              <span>
                <strong>Sent for approval.</strong> This is recorded as a sales order against{' '}
                {buyerName}. It is not in the accounts yet — it reaches the ledger once
                somebody with the authority approves it. If there was no signal it waits in
                the outbox and goes by itself.
              </span>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setQueued(false);
                setLines({});
                setWalkInName('');
              }}
            >
              Record another sale
            </button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Record a sale" subtitle="What went out, and what came in" />

      <div className="stack">
        <Card title="What are you selling?" padded={false}>
          {products.map((product) => {
            const line = lineFor(product);
            const active = line.quantity > 0;
            const candidates = batches.filter(
              (batch) =>
                batch.status === 'ACTIVE' &&
                (!product.moduleKey ||
                  (product.moduleKey === 'snail'
                    ? batch.species === 'SNAIL'
                    : batch.species === 'POULTRY')),
            );

            return (
              <div className="sale-line" key={product.id} data-active={active}>
                <div className="sale-line-head">
                  <div style={{ minWidth: 0 }}>
                    <div className="list-title">{product.name}</div>
                    <div className="faint">
                      per {product.unit} · {VAT_LABELS[product.vat]}
                    </div>
                  </div>
                  <QtyStepper
                    value={line.quantity}
                    unit={product.unit}
                    label={product.name}
                    onChange={(quantity) => update(product, { quantity })}
                  />
                </div>

                {active ? (
                  <div className="sale-line-body">
                    <label className="field">
                      Price per {product.unit}
                      <span className="row" style={{ gap: 'var(--sp-2)' }}>
                        <span className="muted">₦</span>
                        <input
                          inputMode="decimal"
                          className="num"
                          style={{ maxWidth: 140 }}
                          value={(Number(line.priceKobo) / 100).toFixed(2)}
                          onChange={(event) => {
                            const kobo = parseNairaToKobo(event.target.value);
                            if (kobo !== null) update(product, { priceKobo: kobo.toString() });
                          }}
                        />
                        <span className="faint">
                          {formatNaira(toKobo(line.priceKobo) * BigInt(line.quantity))} total
                        </span>
                      </span>
                    </label>

                    {product.fromPopulation ? (
                      <label className="field">
                        Taken from
                        <select
                          value={line.batchId ?? ''}
                          onChange={(event) => update(product, { batchId: event.target.value })}
                        >
                          <option value="">Choose…</option>
                          {candidates.map((batch) => (
                            <option key={batch.id} value={batch.id}>
                              {batch.code} — {batch.population.toLocaleString('en-NG')} left
                            </option>
                          ))}
                        </select>
                        <span className="faint">
                          {(line.quantity * (product.animalsPerUnit ?? 1)).toLocaleString(
                            'en-NG',
                          )}{' '}
                          leave this group, and their share of its cost goes with them.
                        </span>
                      </label>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </Card>

        <Card title="Who is buying?">
          <div className="stack" style={{ gap: 'var(--sp-4)' }}>
            {allowWalkIn ? (
              <div className="chip-row" role="group" aria-label="Buyer type">
                <button
                  type="button"
                  className="chip"
                  aria-pressed={buyerKind === 'walkIn'}
                  onClick={() => setBuyerKind('walkIn')}
                >
                  Someone at the gate
                </button>
                <button
                  type="button"
                  className="chip"
                  aria-pressed={buyerKind === 'customer'}
                  onClick={() => setBuyerKind('customer')}
                >
                  A regular customer
                </button>
              </div>
            ) : null}

            {buyerKind === 'walkIn' ? (
              <label className="field">
                Buyer&apos;s name
                <input
                  value={walkInName}
                  onChange={(event) => setWalkInName(event.target.value)}
                  placeholder="Who bought it"
                />
                <span className="faint">
                  No account needed. Cash at the gate is real income, and refusing to record
                  it just means it goes unrecorded.
                </span>
              </label>
            ) : (
              <label className="field">
                Customer
                <select
                  value={customerId}
                  onChange={(event) => setCustomerId(event.target.value)}
                >
                  {customers.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                      {toKobo(entry.balanceKobo) > 0n
                        ? ` — owes ${formatNaira(entry.balanceKobo)}`
                        : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="field">
              Date
              <input
                type="date"
                value={date}
                max={today}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
          </div>
        </Card>

        <Card title="Payment">
          <div className="stack" style={{ gap: 'var(--sp-4)' }}>
            <div className="chip-row" role="group" aria-label="Payment">
              <button
                type="button"
                className="chip"
                aria-pressed={paidNow}
                onClick={() => setPaidNow(true)}
              >
                Paid now
              </button>
              <button
                type="button"
                className="chip"
                aria-pressed={!paidNow}
                onClick={() => setPaidNow(false)}
                disabled={buyerKind === 'walkIn'}
                title={
                  buyerKind === 'walkIn'
                    ? 'Credit needs a customer record to chase the money'
                    : undefined
                }
              >
                On credit
              </button>
            </div>

            {paidNow ? (
              <label className="field">
                How
                <select value={method} onChange={(event) => setMethod(event.target.value)}>
                  <option>Cash</option>
                  <option>Bank transfer</option>
                  <option>POS</option>
                </select>
              </label>
            ) : (
              <p className="faint" style={{ margin: 0 }}>
                Due in {defaultTermsDays} days. It will show under what you are owed until
                it is paid.
              </p>
            )}

            {overLimit ? (
              <div className="notice notice-warning">
                <span>
                  {customer?.name} would owe{' '}
                  {formatNaira(toKobo(customer?.balanceKobo ?? '0') + total)}, above the{' '}
                  {formatNaira(creditLimitKobo)} limit you set. You can still go ahead — it
                  is your call, not the system&apos;s.
                </span>
              </div>
            ) : null}
          </div>
        </Card>

        {problems.length > 0 && sold.length > 0 ? (
          <div className="notice notice-warning">
            <span>{problems.join('. ')}.</span>
          </div>
        ) : null}

        <div className="entry-actions">
          <span className="num" style={{ fontSize: 16, fontWeight: 600 }}>
            {formatNaira(total)}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={problems.length > 0}
            onClick={() => setReviewing(true)}
          >
            Review sale
          </button>
        </div>
      </div>

      <Sheet
        open={reviewing}
        onClose={() => setReviewing(false)}
        title="Review sale"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setReviewing(false)}>
              Back
            </button>
            <button type="button" className="btn btn-primary" onClick={submit}>
              Record sale
            </button>
          </>
        }
      >
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          <div>
            <div className="faint" style={{ marginBottom: 6 }}>
              SOLD TO
            </div>
            <Line label={buyerName} value={paidNow ? `Paid — ${method}` : `On credit, ${defaultTermsDays} days`} />
          </div>

          <div>
            <div className="faint" style={{ marginBottom: 6 }}>
              ITEMS
            </div>
            {sold.map(({ product, line }) => (
              <Line
                key={product.id}
                label={`${line.quantity} ${product.unit}${line.quantity === 1 ? '' : 's'} · ${product.name}`}
                value={formatNaira(toKobo(line.priceKobo) * BigInt(line.quantity))}
              />
            ))}
            <Line label="VAT" value={vat === 0n ? 'None — zero-rated' : formatNaira(vat)} />
            <Line label="Total" value={formatNaira(total + vat)} />
          </div>

          {sold.some(({ product }) => product.fromPopulation) ? (
            <div>
              <div className="faint" style={{ marginBottom: 6 }}>
                ANIMALS LEAVING
              </div>
              {sold
                .filter(({ product }) => product.fromPopulation)
                .map(({ product, line }) => {
                  const batch = batches.find((entry) => entry.id === line.batchId);
                  const animals = line.quantity * (product.animalsPerUnit ?? 1);
                  return (
                    <Line
                      key={product.id}
                      label={batch?.code ?? 'Unknown'}
                      value={`${batch?.population.toLocaleString('en-NG')} → ${((batch?.population ?? 0) - animals).toLocaleString('en-NG')}`}
                    />
                  );
                })}
            </div>
          ) : null}

          <div>
            <div className="faint" style={{ marginBottom: 6 }}>
              EFFECT ON THE BOOKS
            </div>
            {/*
              Spelled out because this is the whole argument for the accounting
              spine. A sale is not one entry — it is revenue, it is stock
              leaving, and for livestock it is cost coming out of the population.
              Getting the third one right is what makes population profit tie to the
              profit and loss instead of drifting away from it.
            */}
            <Line
              label={paidNow ? `Dr ${method}` : 'Dr Owed by customer'}
              value="Cr Sales income"
            />
            <Line label="Dr Cost of sales" value="Cr Finished goods" />
            {sold.some(({ product }) => product.fromPopulation) ? (
              <Line label="Dr Cost of sales" value="Cr the population's own costs" />
            ) : null}
            <p className="faint" style={{ marginTop: 6 }}>
              Costed when this is wired up, so what a population earned and what it cost end up
              in the same set of books.
            </p>
          </div>

          <div className="notice notice-warning">
            Nothing is saved yet — there is no sales endpoint. This goes to the outbox.
          </div>
        </div>
      </Sheet>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function QtyStepper({
  value,
  unit,
  label,
  onChange,
}: {
  value: number;
  unit: string;
  label: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="stepper">
      <button
        type="button"
        className="stepper-btn"
        aria-label={`Fewer ${label}`}
        disabled={value <= 0}
        onClick={() => onChange(Math.max(0, value - 1))}
      >
        −
      </button>
      <input
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={`${label} quantity`}
        value={value === 0 ? '' : String(value)}
        placeholder="0"
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '');
          onChange(digits === '' ? 0 : Number(digits));
        }}
      />
      <button
        type="button"
        className="stepper-btn"
        aria-label={`More ${label}`}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
      <span className="stepper-unit">{unit}</span>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="row"
      style={{ justifyContent: 'space-between', gap: 'var(--sp-4)', padding: '5px 0' }}
    >
      <span className="muted" style={{ fontSize: 14 }}>
        {label}
      </span>
      <span style={{ fontSize: 14, fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  );
}
