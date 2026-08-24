'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createSupplier, type SupplierFormState } from '@/app/(app)/suppliers/actions';
import { Card } from './ui';

/**
 * Registering a vendor.
 *
 * Grouped the way a person collects the information rather than the way the
 * table stores it: who they are, then how to reach them, then how to pay them.
 * A single flat column of fourteen inputs is how a form gets abandoned.
 *
 * Only the code and the name are required. The rest is genuinely optional —
 * a farm buying feed off a truck may know nothing but a name and a phone
 * number on the first day, and refusing the record until they have a TIN means
 * they keep the vendor in their head instead.
 */
export function SupplierForm() {
  const [state, action] = useActionState<SupplierFormState, FormData>(createSupplier, {
    error: null,
    created: null,
  });

  return (
    <Card title="Register a vendor" subtitle="You cannot buy from somebody the system has never heard of">
      <form action={action} className="stack" style={{ gap: 'var(--sp-4)' }}>
        {state.error ? <div className="notice notice-error">{state.error}</div> : null}
        {state.created ? (
          <div className="notice notice-success">
            <span>
              <strong>{state.created}</strong> is registered. You can raise a purchase
              against them now.
            </span>
          </div>
        ) : null}

        <div className="grid-auto">
          <Field
            name="code"
            label="Vendor code"
            hint="Short and unique — SUP-GREENFIELDS."
            defaultValue={state.values?.code}
            required
          />
          <Field
            name="name"
            label="Vendor name"
            hint="As it appears on their invoice."
            defaultValue={state.values?.name}
            required
          />
        </div>

        <div className="grid-auto">
          <Field
            name="category"
            label="What they supply"
            hint="Feed, veterinary, equipment."
            defaultValue={state.values?.category}
          />
          <Field
            name="tin"
            label="TIN"
            hint="Their tax identification number, if you have it."
            defaultValue={state.values?.tin}
          />
        </div>

        <div className="grid-auto">
          <Field name="phone" label="Phone" defaultValue={state.values?.phone} />
          <Field name="email" label="Email" type="email" defaultValue={state.values?.email} />
        </div>

        <Field name="address" label="Address" defaultValue={state.values?.address} />

        <div className="grid-auto">
          <Field
            name="bankName"
            label="Bank"
            hint="Where payments go when you settle their invoice."
            defaultValue={state.values?.bankName}
          />
          <Field
            name="accountNumber"
            label="Account number"
            defaultValue={state.values?.accountNumber}
          />
        </div>
        <Field name="accountName" label="Account name" defaultValue={state.values?.accountName} />

        <Submit />
      </form>
    </Card>
  );
}

function Field({
  name,
  label,
  hint,
  type = 'text',
  defaultValue,
  required,
}: {
  name: string;
  label: string;
  hint?: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label className="field">
      {label}
      {required ? null : <span className="faint"> (optional)</span>}
      <input name={name} type={type} defaultValue={defaultValue} required={required} />
      {hint ? <span className="faint">{hint}</span> : null}
    </label>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Saving…' : 'Register vendor'}
      </button>
    </div>
  );
}
