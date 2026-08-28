'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Card } from './ui';
import { formatNaira, parseNairaToKobo } from '@/lib/money';
import { convertRequisitionToOrder, type FlowState } from '@/app/(app)/procurement/actions';
import type { Requisition } from '@/lib/procurement';
import type { Supplier } from '@/lib/demo-trade';

/**
 * Turning an approved requisition into a commitment to a named supplier.
 *
 * This is the moment a supplier and a price enter the chain for the first
 * time — the requisition carried neither. Quantities default to what is
 * still outstanding on each line, since converting the whole thing in one
 * order is the common case.
 */
export function ConvertRequisitionForm({
  requisition,
  suppliers,
  today,
}: {
  requisition: Requisition;
  suppliers: Supplier[];
  today: string;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(convertRequisitionToOrder, {
    error: null,
    message: null,
  });

  const outstanding = requisition.lines.filter((line) => Number(line.outstandingQuantity) > 0);

  return (
    <Card
      title={`Convert ${requisition.requisitionNumber}`}
      subtitle="Name the supplier and the agreed price"
    >
      <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
        <input type="hidden" name="requisitionId" value={requisition.id} />

        {state.error ? <div className="notice notice-error">{state.error}</div> : null}

        <div className="grid-auto">
          <label className="field">
            Supplier
            <select name="supplierId" defaultValue="" required>
              <option value="" disabled>
                Choose a supplier
              </option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Order date
            <input type="date" name="orderDate" defaultValue={today} required />
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
                <th style={{ width: 130 }}>Quantity</th>
                <th style={{ width: 160 }}>Unit price</th>
              </tr>
            </thead>
            <tbody>
              {outstanding.map((line) => (
                <LineRow key={line.id} line={line} />
              ))}
            </tbody>
          </table>
        </div>

        {outstanding.length === 0 ? (
          <div className="notice notice-warning">
            Everything on this requisition has already been ordered.
          </div>
        ) : null}

        <Submit disabled={outstanding.length === 0} />
      </form>
    </Card>
  );
}

function LineRow({ line }: { line: Requisition['lines'][number] }) {
  const outstanding = Number(line.outstandingQuantity);
  const [quantity, setQuantity] = useState(outstanding > 0 ? trim(outstanding) : '');
  const [price, setPrice] = useState(
    formatNaira(line.estimatedUnitCostKobo).replace(/[₦,]/g, ''),
  );

  return (
    <tr>
      <td>
        <input type="hidden" name="lineId" value={line.id} />
        <input type="hidden" name={`itemId:${line.id}`} value={line.itemId} />
        <span className="strong">{line.itemCode}</span>
        <div className="faint">{line.description}</div>
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
        <input
          name={`price:${line.id}`}
          type="hidden"
          value={(parseNairaToKobo(price) ?? 0n).toString()}
        />
        <input
          type="text"
          inputMode="decimal"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          style={{ minHeight: 0 }}
        />
      </td>
    </tr>
  );
}

function trim(value: number): string {
  return String(Number(value.toFixed(6)));
}

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending || disabled}>
        {pending ? 'Converting…' : 'Convert to a purchase order'}
      </button>
    </div>
  );
}
