'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { raiseSalesInvoice, type FlowState } from '@/app/(app)/sales/actions';

const EMPTY: FlowState = { error: null, message: null };

/**
 * One click: bill an order for whatever it has shipped but not yet invoiced.
 *
 * No line entry, because there is nothing to decide — the invoice is for
 * delivered-minus-invoiced, and the API already knows that figure.
 */
export function RaiseInvoiceButton({ orderId, today }: { orderId: string; today: string }) {
  const [state, formAction] = useActionState<FlowState, FormData>(raiseSalesInvoice, EMPTY);

  return (
    <form action={formAction}>
      <input type="hidden" name="salesOrderId" value={orderId} />
      <input type="hidden" name="invoiceDate" value={today} />
      <Pending />
      {state.error ? (
        <div className="faint" style={{ color: 'var(--error-700)' }}>
          {state.error}
        </div>
      ) : null}
    </form>
  );
}

function Pending() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Raising…' : 'Raise invoice'}
    </button>
  );
}
