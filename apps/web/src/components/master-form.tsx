'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { MasterState } from '@/app/(app)/admin/actions';
import { Card } from './ui';

export interface FieldSpec {
  name: string;
  label: string;
  hint?: string;
  type?: 'text' | 'email' | 'number' | 'checkbox';
  required?: boolean;
  /** Renders a select rather than an input. */
  options?: Array<{ value: string; label: string }>;
  /** Half-width, so related fields sit side by side. */
  half?: boolean;
}

/**
 * One form for every master record.
 *
 * Vendors, items, customers, stores and cost centres are the same shape: a
 * short code, a name, and a handful of fields that decide how the thing
 * behaves downstream. Writing five near-identical forms would mean five places
 * for the error handling to drift apart — and the error handling is the part
 * that matters, because a rejected form that loses what you typed is a form
 * people stop using.
 */
export function MasterForm({
  title,
  subtitle,
  submitLabel,
  fields,
  action,
}: {
  title: string;
  subtitle: string;
  submitLabel: string;
  fields: FieldSpec[];
  action: (state: MasterState, form: FormData) => Promise<MasterState>;
}) {
  const [state, formAction] = useActionState<MasterState, FormData>(action, {
    error: null,
    created: null,
  });

  // Consecutive half-width fields are paired into a row; everything else runs
  // full width.
  const rows: FieldSpec[][] = [];
  for (const field of fields) {
    const last = rows[rows.length - 1];
    if (field.half && last?.length === 1 && last[0]?.half) last.push(field);
    else rows.push([field]);
  }

  return (
    <Card title={title} subtitle={subtitle}>
      <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
        {state.error ? <div className="notice notice-error">{state.error}</div> : null}
        {state.created ? (
          <div className="notice notice-success">
            <strong>{state.created}</strong> saved.
          </div>
        ) : null}

        {rows.map((row, index) => (
          <div key={index} className={row.length > 1 ? 'grid-auto' : undefined}>
            {row.map((field) => (
              <Field key={field.name} field={field} value={state.values?.[field.name]} />
            ))}
          </div>
        ))}

        <Submit label={submitLabel} />
      </form>
    </Card>
  );
}

function Field({ field, value }: { field: FieldSpec; value?: string }) {
  if (field.type === 'checkbox') {
    return (
      <label className="field row" style={{ gap: 'var(--sp-3)', alignItems: 'center' }}>
        <input type="checkbox" name={field.name} style={{ width: 'auto', minHeight: 0 }} />
        <span>
          {field.label}
          {field.hint ? <span className="faint"> — {field.hint}</span> : null}
        </span>
      </label>
    );
  }

  return (
    <label className="field">
      {field.label}
      {field.required ? null : <span className="faint"> (optional)</span>}
      {field.options ? (
        <select name={field.name} defaultValue={value ?? field.options[0]?.value}>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          name={field.name}
          type={field.type ?? 'text'}
          {...(field.type === 'number' ? { step: 'any', inputMode: 'decimal' as const } : {})}
          defaultValue={value}
          required={field.required}
        />
      )}
      {field.hint ? <span className="faint">{field.hint}</span> : null}
    </label>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Saving…' : label}
      </button>
    </div>
  );
}
