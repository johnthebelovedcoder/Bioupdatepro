'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface SupplierFormState {
  error: string | null;
  created: string | null;
  /** Kept so a rejected form refills itself instead of losing everything. */
  values?: Record<string, string>;
}

/**
 * Register a vendor.
 *
 * The first master record the product ever let anybody create. Until now every
 * supplier, customer, item and pen arrived from a seed script — so a farm that
 * signed up could not register the vendor it buys feed from, could not raise a
 * requisition against them, and therefore could never receive stock or post
 * anything to the ledger. The whole procure-to-pay chain existed in the API
 * with no way in.
 *
 * Company and actor are not sent: the API takes both from the session.
 */
export async function createSupplier(
  _previous: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const value = (key: string) => String(formData.get(key) ?? '').trim();

  const code = value('code').toUpperCase();
  const name = value('name');
  const kept: Record<string, string> = {
    code,
    name,
    category: value('category'),
    tin: value('tin'),
    phone: value('phone'),
    email: value('email'),
    address: value('address'),
    bankName: value('bankName'),
    accountNumber: value('accountNumber'),
    accountName: value('accountName'),
  };

  if (!code) return { error: 'Give the vendor a code.', created: null, values: kept };
  if (!name) return { error: "Enter the vendor's name.", created: null, values: kept };

  try {
    await api('/masters/suppliers', {
      method: 'POST',
      body: {
        code,
        name,
        category: kept.category || null,
        tin: kept.tin || null,
        phone: kept.phone || null,
        email: kept.email || null,
        address: kept.address || null,
        bankName: kept.bankName || null,
        accountNumber: kept.accountNumber || null,
        accountName: kept.accountName || null,
      },
    });
  } catch (caught) {
    const message =
      caught instanceof ApiError ? caught.message : 'Could not save that vendor.';
    return { error: message, created: null, values: kept };
  }

  // The list on the same page has to show it immediately, or the person cannot
  // tell whether it saved.
  revalidatePath('/suppliers');
  return { error: null, created: name };
}
