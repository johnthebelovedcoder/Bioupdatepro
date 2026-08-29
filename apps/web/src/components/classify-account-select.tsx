'use client';

import { useTransition } from 'react';
import { classifyAccount } from '@/app/(app)/admin/accounts/actions';

const CATEGORIES = [
  'CURRENT_ASSET',
  'NON_CURRENT_ASSET',
  'CURRENT_LIABILITY',
  'NON_CURRENT_LIABILITY',
  'EQUITY',
  'REVENUE',
  'COST_OF_SALES',
  'OPERATING_EXPENSE',
  'OTHER_INCOME',
  'OTHER_EXPENSE',
];

function label(value: string): string {
  return value
    .split('_')
    .map((word) => word[0] + word.slice(1).toLowerCase())
    .join(' ');
}

/** A per-row classify control — one field, saved the moment it changes. */
export function ClassifyAccountSelect({
  accountId,
  fsCategory,
}: {
  accountId: string;
  fsCategory: string | null;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      defaultValue={fsCategory ?? ''}
      disabled={pending}
      style={{ minHeight: 32, padding: '4px 8px', fontSize: 13 }}
      onChange={(event) => {
        const formData = new FormData();
        formData.set('accountId', accountId);
        formData.set('fsCategory', event.target.value);
        startTransition(() => {
          void classifyAccount(formData);
        });
      }}
    >
      <option value="" disabled>
        Not classified
      </option>
      {CATEGORIES.map((category) => (
        <option key={category} value={category}>
          {label(category)}
        </option>
      ))}
    </select>
  );
}
