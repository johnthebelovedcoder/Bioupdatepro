'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Card } from './ui';
import { formatNaira } from '@/lib/money';
import { receiveGoods, type FlowState } from '@/app/(app)/procurement/actions';
import type { PurchaseOrder } from '@/lib/procurement';

/**
 * Recording a delivery.
 *
 * This is the screen the whole procure-to-pay chain has been waiting for. Up to
 * here nothing has touched the accounts: a requisition is a request, an order
 * is a promise. The moment goods are accepted into the store the farm owns
 * something it did not own before and owes for something it has not been
 * billed for, and the ledger says so — `Dr Inventory / Cr GRNI`.
 *
 * The form opens with the outstanding quantity already filled in, because the
 * common case is that everything ordered turned up. Rejecting is the exception
 * and reads like one.
 */
export function GoodsReceiptForm({ order, today }: { order: PurchaseOrder; today: string }) {
  const [state, formAction] = useActionState<FlowState, FormData>(receiveGoods, {
    error: null,
    message: null,
  });

  return (
    <Card
      title={`Receive against ${order.orderNumber}`}
      subtitle={`${order.supplier} — enter what actually came off the vehicle`}
    >
      <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
        <input type="hidden" name="purchaseOrderId" value={order.id} />

        {state.error ? <div className="notice notice-error">{state.error}</div> : null}

        <div className="grid-auto">
          <label className="field">
            Date received
            <input type="date" name="receiptDate" defaultValue={today} required />
            <span className="faint">
              Decides which accounting period the entry lands in.
            </span>
          </label>
          <label className="field">
            Delivery note number<span className="faint"> (optional)</span>
            <input name="deliveryNoteReference" placeholder="The supplier's own reference" />
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
                <th style={{ width: 130 }}>Received</th>
                <th style={{ width: 130 }}>Rejected</th>
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

        <p className="muted" style={{ fontSize: 14 }}>
          Rejected goods stay off the books entirely — they are counted as arrived and sent
          back, so neither the stock nor the amount owed includes them.
        </p>

        <Submit />
      </form>
    </Card>
  );
}

function LineRow({ line }: { line: PurchaseOrder['lines'][number] }) {
  const outstanding = Math.max(
    0,
    Number(line.orderedQuantity) - Number(line.receivedQuantity),
  );
  const [received, setReceived] = useState(outstanding > 0 ? String(outstanding) : '');

  const shortfall = received !== '' && Number(received) < outstanding;

  return (
    <tr>
      <td>
        <input type="hidden" name="lineId" value={line.id} />
        <span className="strong">{line.itemCode}</span>
        <div className="faint">{line.description}</div>
        <div className="faint">
          {formatNaira(line.unitPriceKobo)} each
          {line.itemType !== 'INVENTORY' ? ' — not stocked, so no stock entry' : null}
        </div>
      </td>
      <td className="num">{trim(outstanding)}</td>
      <td>
        <input
          name={`received:${line.id}`}
          type="number"
          step="any"
          inputMode="decimal"
          min="0"
          value={received}
          onChange={(event) => setReceived(event.target.value)}
          style={{ minHeight: 0 }}
        />
        {shortfall ? <span className="faint">short of the order</span> : null}
      </td>
      <td>
        <input
          name={`rejected:${line.id}`}
          type="number"
          step="any"
          inputMode="decimal"
          min="0"
          placeholder="0"
          style={{ minHeight: 0 }}
        />
      </td>
      <td>
        <input
          name={`batch:${line.id}`}
          placeholder="optional"
          style={{ minHeight: 0 }}
        />
      </td>
    </tr>
  );
}

/** 25.000000 is not a quantity anybody says out loud. */
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
