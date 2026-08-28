'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Card } from './ui';
import { formatNaira } from '@/lib/money';
import { deliverGoods, type FlowState } from '@/app/(app)/sales/actions';
import type { SalesOrder } from '@/lib/sales';

/**
 * Shipping goods against an order.
 *
 * The Buying-side mirror of this screen (`GoodsReceiptForm`) is what makes a
 * delivery feel familiar rather than novel: same idea, opposite direction —
 * stock leaves instead of arriving, and depending on how this company
 * recognises cost of sales, the ledger may move here or wait for the
 * invoice.
 */
export function DeliveryForm({ order, today }: { order: SalesOrder; today: string }) {
  const [state, formAction] = useActionState<FlowState, FormData>(deliverGoods, {
    error: null,
    message: null,
  });

  return (
    <Card
      title={`Ship against ${order.orderNumber}`}
      subtitle={`${order.customer} — enter what is actually going out`}
    >
      <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
        <input type="hidden" name="salesOrderId" value={order.id} />

        {state.error ? <div className="notice notice-error">{state.error}</div> : null}

        <div className="grid-auto">
          <label className="field">
            Date shipped
            <input type="date" name="deliveryDate" defaultValue={today} required />
          </label>
          <label className="field">
            Driver<span className="faint"> (optional)</span>
            <input name="driverName" placeholder="Who is taking it" />
          </label>
          <label className="field">
            Vehicle<span className="faint"> (optional)</span>
            <input name="vehicleNumber" placeholder="Plate number" />
          </label>
        </div>

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th className="right" style={{ width: 110 }}>
                  Outstanding
                </th>
                <th style={{ width: 130 }}>Shipping</th>
                <th style={{ width: 150 }}>Batch</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <LineRow key={line.id} line={line} />
              ))}
            </tbody>
          </table>
        </div>

        <Submit />
      </form>
    </Card>
  );
}

function LineRow({ line }: { line: SalesOrder['lines'][number] }) {
  const outstanding = Math.max(0, Number(line.orderedQuantity) - Number(line.deliveredQuantity));
  const [quantity, setQuantity] = useState(outstanding > 0 ? String(outstanding) : '');

  return (
    <tr>
      <td>
        <input type="hidden" name="lineId" value={line.id} />
        <span className="strong">{line.itemCode}</span>
        <div className="faint">{line.description}</div>
        <div className="faint">{formatNaira(line.unitPriceKobo)} each</div>
      </td>
      <td className="num">{trim(outstanding)}</td>
      <td>
        <input
          name={`quantity:${line.id}`}
          type="number"
          step="any"
          inputMode="decimal"
          min="0"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          style={{ minHeight: 0 }}
        />
      </td>
      <td>
        <input name={`batch:${line.id}`} placeholder="optional" style={{ minHeight: 0 }} />
      </td>
    </tr>
  );
}

function trim(value: number): string {
  return String(Number(value.toFixed(6)));
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Recording…' : 'Record the delivery'}
      </button>
    </div>
  );
}
