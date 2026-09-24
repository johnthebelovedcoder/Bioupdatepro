'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  amendAndResubmitOrder,
  submitOrder,
  type FlowState,
} from '@/app/(app)/procurement/actions';
import { formatNaira, parseNairaToKobo } from '@/lib/money';
import type { OrderLine } from '@/lib/procurement';

/**
 * Correct a returned order's quantities and prices and send it back.
 *
 * Only what an approver can reasonably send an order back over is editable —
 * how much, at what price. A different item or supplier is a different order.
 */
export function AmendOrderForm({ orderId, lines }: { orderId: string; lines: OrderLine[] }) {
  const [state, formAction] = useActionState<FlowState, FormData>(amendAndResubmitOrder, {
    error: null,
    message: null,
  });
  const [prices, setPrices] = useState(() =>
    lines.map((line) => formatNaira(line.unitPriceKobo, { symbol: false })),
  );
  const [quantities, setQuantities] = useState(() => lines.map((line) => line.orderedQuantity));
  const router = useRouter();

  useEffect(() => {
    if (state.message) router.refresh();
    // Only when a fresh success message arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.message]);

  const original = JSON.stringify(
    lines.map((line) => ({
      itemId: line.itemId,
      description: line.lineDescription,
      requisitionLineId: line.requisitionLineId,
      quantity: line.orderedQuantity,
      unitPriceKobo: line.unitPriceKobo,
      taxCode: line.taxCode,
    })),
  );

  const total = lines.reduce((sum, _line, index) => {
    const price = parseNairaToKobo(prices[index] ?? '') ?? 0n;
    const quantity = Number(quantities[index] ?? 0);
    // Display only — the API computes the real line amounts.
    return sum + BigInt(Math.round(Number(price) * (Number.isFinite(quantity) ? quantity : 0)));
  }, 0n);

  return (
    <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="original" value={original} />

      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}

      <div className="table-wrap">
        <table className="data wide">
          <thead>
            <tr>
              <th style={{ width: 50 }}>#</th>
              <th>Item</th>
              <th style={{ width: 140 }}>Quantity</th>
              <th style={{ width: 170 }}>Unit price (₦)</th>
              <th style={{ width: 90 }}>Tax</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.id}>
                <td className="num" style={{ textAlign: 'left' }}>
                  {line.lineNumber}
                </td>
                <td style={{ textAlign: 'left' }}>
                  {line.itemCode} — {line.lineDescription}
                </td>
                <td>
                  <input
                    name={`quantity:${index}`}
                    inputMode="decimal"
                    value={quantities[index]}
                    onChange={(e) =>
                      setQuantities((all) => all.map((q, i) => (i === index ? e.target.value : q)))
                    }
                    required
                  />
                </td>
                <td>
                  <input
                    inputMode="decimal"
                    value={prices[index]}
                    onChange={(e) =>
                      setPrices((all) => all.map((p, i) => (i === index ? e.target.value : p)))
                    }
                    required
                  />
                  <input
                    type="hidden"
                    name={`priceKobo:${index}`}
                    value={(parseNairaToKobo(prices[index] ?? '') ?? '').toString()}
                  />
                </td>
                <td className="faint">{line.taxCode ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
        <span className="faint">
          About {formatNaira(total)} before tax. The order&rsquo;s version goes up by one, so the
          approver can see it changed.
        </span>
        <Submit />
      </div>
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Saving…' : 'Save and send for approval'}
    </button>
  );
}

/** Send a draft as it stands, without changing it. */
export function SubmitOrderButton({ orderId }: { orderId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      <div>
        <button
          type="button"
          className="btn"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await submitOrder(orderId);
              setError(result.error);
              if (!result.error) router.refresh();
            })
          }
        >
          {pending ? 'Sending…' : 'Send unchanged'}
        </button>
      </div>
      {error ? <div className="notice notice-error">{error}</div> : null}
    </div>
  );
}
