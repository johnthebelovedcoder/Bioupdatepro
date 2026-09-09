'use client';

import { useMemo, useState } from 'react';
import type { Supplier } from '@/lib/demo-trade';
import type { StockItem as InventoryItem } from '@/lib/masters';
import { formatNaira, parseNairaToKobo, toKobo } from '@/lib/money';
import { enqueue, flush } from '@/lib/sync-queue';
import { Card, PageHeader } from './ui';
import { Sheet } from './sheet';

/**
 * Buying feed and supplies.
 *
 * The other half of the sale form, and the answer to the most common alert this
 * product raises: feed is about to run out, order more. An alert whose action
 * leads nowhere is just a notification.
 *
 * Two modes, because farms work both ways and the accounting differs:
 *
 *   ORDERING places an order for later delivery. Nothing moves — no stock, no
 *   money — until the goods arrive. Recording stock at order time is how a
 *   store ends up showing feed that is still on a lorry.
 *
 *   RECEIVED means it is here now. Stock goes up immediately and the farm owes
 *   the supplier, whether or not it has paid yet.
 *
 * The distinction matters enough that it is the first question on the form
 * rather than a checkbox at the bottom.
 */

interface Line {
  itemId: string;
  quantity: number;
  unitCostKobo: string;
}

export function RecordPurchase({
  items,
  suppliers,
  today,
  suggestedItem,
  suggestedQuantity,
}: {
  items: InventoryItem[];
  suppliers: Supplier[];
  today: string;
  /** Pre-selected when arriving from a "feed is running out" alert. */
  suggestedItem?: string;
  /** How much to buy, worked out from current use. A starting point only. */
  suggestedQuantity?: number;
}) {
  const [mode, setMode] = useState<'order' | 'received'>('received');
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState('');
  const [paidNow, setPaidNow] = useState(false);
  const [lines, setLines] = useState<Record<string, Line>>(() => {
    // Arriving from an alert, the item that raised it starts selected — the
    // farmer already said what they wanted by tapping "Order feed".
    const match = suggestedItem
      ? items.find((item) => item.code === suggestedItem || item.name === suggestedItem)
      : undefined;
    if (!match) return {};
    return {
      [match.id]: {
        itemId: match.id,
        quantity: suggestedQuantity ?? 0,
        unitCostKobo: match.unitCostKobo,
      },
    };
  });
  const [reviewing, setReviewing] = useState(false);
  const [queued, setQueued] = useState(false);

  function lineFor(item: InventoryItem): Line {
    return (
      lines[item.id] ?? { itemId: item.id, quantity: 0, unitCostKobo: item.unitCostKobo }
    );
  }

  function update(item: InventoryItem, change: Partial<Line>) {
    setLines((current) => ({ ...current, [item.id]: { ...lineFor(item), ...change } }));
  }

  const bought = useMemo(
    () =>
      items
        .map((item) => ({ item, line: lines[item.id] }))
        .filter((entry): entry is { item: InventoryItem; line: Line } =>
          Boolean(entry.line && entry.line.quantity > 0),
        ),
    [items, lines],
  );

  const total = bought.reduce(
    (sum, { line }) => sum + toKobo(line.unitCostKobo) * BigInt(line.quantity),
    0n,
  );

  const supplier = suppliers.find((entry) => entry.id === supplierId);

  const problems: string[] = [];
  if (bought.length === 0) problems.push('Add at least one thing you are buying');
  if (!supplier) problems.push('Choose a supplier');
  for (const { item, line } of bought) {
    if (toKobo(line.unitCostKobo) <= 0n) problems.push(`Set a price for ${item.name}`);
  }

  function submit() {
    enqueue({
      kind: 'purchase',
      label: `${mode === 'order' ? 'Order' : 'Goods received'} · ${supplier?.name} · ${formatNaira(total)}`,
      payload: {
        type: mode === 'order' ? 'purchase-order' : 'goods-received',
        date,
        supplierId,
        reference: reference.trim() || null,
        paidNow: mode === 'received' ? paidNow : false,
        lines: bought.map(({ item, line }) => ({
          itemId: item.id,
          code: item.code,
          quantity: line.quantity,
          unit: item.unit,
          unitCostKobo: line.unitCostKobo,
        })),
        totalKobo: total.toString(),
      },
    });
    void flush();
    setReviewing(false);
    setQueued(true);
  }

  if (queued) {
    return (
      <>
        <PageHeader
          title={mode === 'order' ? 'Order placed' : 'Goods received'}
          subtitle={`${supplier?.name} · ${formatNaira(total)}`}
        />
        <Card>
          <div className="stack" style={{ gap: 'var(--sp-4)' }}>
            <div className="notice notice-info">
              <span>
                <strong>Sent for approval.</strong> This is recorded as a purchase order.{' '}
                {mode === 'received'
                  ? 'The stock does not move until the goods receipt is raised against the approved order — so the store count has not changed yet.'
                  : 'It becomes a commitment once approved.'}{' '}
                If there was no signal it waits in the outbox and goes by itself.
              </span>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setQueued(false);
                setLines({});
                setReference('');
              }}
            >
              Record another
            </button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Buy supplies" subtitle="Feed, medication and everything else" />

      <div className="stack">
        <Card title="Is it here yet?">
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="chip-row" role="group" aria-label="Purchase stage">
              <button
                type="button"
                className="chip"
                aria-pressed={mode === 'received'}
                onClick={() => setMode('received')}
              >
                It has arrived
              </button>
              <button
                type="button"
                className="chip"
                aria-pressed={mode === 'order'}
                onClick={() => setMode('order')}
              >
                Just ordering it
              </button>
            </div>
            <p className="faint" style={{ margin: 0 }}>
              {mode === 'received'
                ? 'Stock goes up now and you owe the supplier.'
                : 'Nothing moves until it arrives — stock that is still on a lorry is not stock.'}
            </p>
          </div>
        </Card>

        <Card title="What are you buying?" padded={false}>
          {items.map((item) => {
            const line = lineFor(item);
            const active = line.quantity > 0;
            const low = item.reorderLevel !== null && item.onHand <= item.reorderLevel;
            return (
              <div
                className="sale-line"
                key={item.id}
                data-active={active}
                data-suggested={
                  item.code === suggestedItem || item.name === suggestedItem ? true : undefined
                }
              >
                <div className="sale-line-head">
                  <div style={{ minWidth: 0 }}>
                    <div className="list-title">
                      {item.name}
                      {low ? (
                        <span className="badge badge-warning" style={{ marginLeft: 8 }}>
                          low
                        </span>
                      ) : null}
                    </div>
                    <div className="faint">
                      {item.onHand.toLocaleString('en-NG')} {item.unit} in store
                      {item.reorderLevel !== null
                        ? ` · reorder at ${item.reorderLevel.toLocaleString('en-NG')}`
                        : ''}
                    </div>
                  </div>
                  <QtyStepper
                    value={line.quantity}
                    unit={item.unit}
                    step={item.unit === 'kg' ? 50 : 1}
                    label={item.name}
                    onChange={(quantity) => update(item, { quantity })}
                  />
                </div>

                {active ? (
                  <div className="sale-line-body">
                    <label className="field">
                      Price per {item.unit}
                      <span className="row" style={{ gap: 'var(--sp-2)' }}>
                        <span className="muted">₦</span>
                        <input
                          inputMode="decimal"
                          className="num"
                          style={{ maxWidth: 140 }}
                          value={(Number(line.unitCostKobo) / 100).toFixed(2)}
                          onChange={(event) => {
                            const kobo = parseNairaToKobo(event.target.value);
                            if (kobo !== null) update(item, { unitCostKobo: kobo.toString() });
                          }}
                        />
                        <span className="faint">
                          {formatNaira(toKobo(line.unitCostKobo) * BigInt(line.quantity))} total
                        </span>
                      </span>
                    </label>
                    {mode === 'received' ? (
                      <div className="field">
                        Store after this
                        <span className="num" style={{ textAlign: 'left', fontSize: 15 }}>
                          {(item.onHand + line.quantity).toLocaleString('en-NG')} {item.unit}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </Card>

        <Card title="Supplier">
          <div className="stack" style={{ gap: 'var(--sp-4)' }}>
            <label className="field">
              Who from
              <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                {suppliers.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                    {toKobo(entry.balanceKobo) > 0n
                      ? ` — you owe ${formatNaira(entry.balanceKobo)}`
                      : ''}
                  </option>
                ))}
              </select>
              {supplier ? (
                <span className="faint">Normally pays on {supplier.terms.toLowerCase()}</span>
              ) : null}
            </label>

            <label className="field">
              Date
              <input
                type="date"
                value={date}
                max={today}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>

            <label className="field">
              Waybill or invoice number
              <input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Optional"
              />
            </label>

            {mode === 'received' ? (
              <div className="chip-row" role="group" aria-label="Payment">
                <button
                  type="button"
                  className="chip"
                  aria-pressed={!paidNow}
                  onClick={() => setPaidNow(false)}
                >
                  Pay later
                </button>
                <button
                  type="button"
                  className="chip"
                  aria-pressed={paidNow}
                  onClick={() => setPaidNow(true)}
                >
                  Paid already
                </button>
              </div>
            ) : null}
          </div>
        </Card>

        {problems.length > 0 && bought.length > 0 ? (
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
            Review
          </button>
        </div>
      </div>

      <Sheet
        open={reviewing}
        onClose={() => setReviewing(false)}
        title={mode === 'order' ? 'Review order' : 'Review goods received'}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setReviewing(false)}>
              Back
            </button>
            <button type="button" className="btn btn-primary" onClick={submit}>
              {mode === 'order' ? 'Place order' : 'Record it'}
            </button>
          </>
        }
      >
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          <Line label="Supplier" value={supplier?.name ?? ''} />
          {bought.map(({ item, line }) => (
            <Line
              key={item.id}
              label={`${line.quantity.toLocaleString('en-NG')} ${item.unit} · ${item.name}`}
              value={formatNaira(toKobo(line.unitCostKobo) * BigInt(line.quantity))}
            />
          ))}
          <Line label="Total" value={formatNaira(total)} />

          <div>
            <div className="faint" style={{ marginBottom: 6 }}>
              EFFECT ON THE BOOKS
            </div>
            {mode === 'order' ? (
              <p className="faint" style={{ margin: 0 }}>
                None. An order is a commitment, not a transaction — nothing is posted until
                the goods arrive.
              </p>
            ) : (
              <>
                <Line label="Dr Feed & supplies in store" value="Cr Owed to supplier" />
                {paidNow ? <Line label="Dr Owed to supplier" value="Cr Cash" /> : null}
                <p className="faint" style={{ marginTop: 6 }}>
                  When the supplier&apos;s invoice arrives it clears what is owed rather than
                  adding stock a second time.
                </p>
              </>
            )}
          </div>

          <div className="notice notice-info">
            Goes to the outbox on this device and sends when there is a connection.
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
  step,
  label,
  onChange,
}: {
  value: number;
  unit: string;
  step: number;
  label: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="stepper">
      <button
        type="button"
        className="stepper-btn"
        aria-label={`Less ${label}`}
        title={`Less ${label}`}
        disabled={value <= 0}
        onClick={() => onChange(Math.max(0, value - step))}
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
        title={`More ${label}`}
        onClick={() => onChange(value + step)}
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
