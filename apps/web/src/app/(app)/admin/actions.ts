'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface MasterState {
  error: string | null;
  created: string | null;
  values?: Record<string, string>;
}

function fail(caught: unknown, fallback: string, values: Record<string, string>): MasterState {
  return {
    error: caught instanceof ApiError ? caught.message : fallback,
    created: null,
    values,
  };
}

/**
 * Create an item — feed, medication, produce, anything bought, stored or sold.
 *
 * Three fields decide where the money goes and none of them can be guessed
 * from the name: the unit it is measured in, its VAT treatment, and its type.
 * Getting the VAT code wrong silently misstates recoverable input tax, so the
 * form asks rather than assuming — and offers only codes this company has.
 */
export async function createItem(
  _previous: MasterState,
  formData: FormData,
): Promise<MasterState> {
  const value = (key: string) => String(formData.get(key) ?? '').trim();
  const code = value('code').toUpperCase();
  const description = value('description');
  const kept = {
    code,
    description,
    category: value('category'),
    unitOfMeasureCode: value('unitOfMeasureCode'),
    itemType: value('itemType'),
    vatTaxCode: value('vatTaxCode'),
    reorderLevel: value('reorderLevel'),
    standardCost: value('standardCost'),
    inventoryGlAccountId: value('inventoryGlAccountId'),
    expenseGlAccountId: value('expenseGlAccountId'),
  };

  if (!code) return { error: 'Give the item a code.', created: null, values: kept };
  if (!description) return { error: 'Describe the item.', created: null, values: kept };
  if (!kept.unitOfMeasureCode) {
    return { error: 'Choose how it is measured.', created: null, values: kept };
  }

  // Naira in, kobo out — the API takes integer kobo and nothing else.
  const cost = kept.standardCost ? Math.round(Number(kept.standardCost) * 100) : null;
  if (kept.standardCost && !Number.isFinite(cost)) {
    return { error: 'That cost is not a number I can read.', created: null, values: kept };
  }

  try {
    await api('/masters/items', {
      method: 'POST',
      body: {
        code,
        description,
        category: kept.category || null,
        itemType: kept.itemType || 'INVENTORY',
        unitOfMeasureCode: kept.unitOfMeasureCode,
        vatTaxCode: kept.vatTaxCode || null,
        // Where a receipt of this item debits. The API refuses an inventory
        // item without one, because goods receipt posts Dr Inventory / Cr GRNI
        // and would otherwise have nowhere to put the debit.
        inventoryGlAccountId: value('inventoryGlAccountId') || null,
        expenseGlAccountId: value('expenseGlAccountId') || null,
        isBiologicalFeed: formData.get('isBiologicalFeed') === 'on',
        reorderLevel: kept.reorderLevel || null,
        ...(cost !== null && cost > 0
          ? { standardCostKobo: String(cost), standardCostFrom: new Date().toISOString() }
          : {}),
      },
    });
  } catch (caught) {
    return fail(caught, 'Could not save that item.', kept);
  }

  revalidatePath('/items');
  return { error: null, created: description };
}

/** Create a customer — everyone you sell to. */
export async function createCustomer(
  _previous: MasterState,
  formData: FormData,
): Promise<MasterState> {
  const value = (key: string) => String(formData.get(key) ?? '').trim();
  const code = value('code').toUpperCase();
  const name = value('name');
  const kept = {
    code,
    name,
    category: value('category'),
    tin: value('tin'),
    phone: value('phone'),
    email: value('email'),
    state: value('state'),
    creditLimit: value('creditLimit'),
  };

  if (!code) return { error: 'Give the customer a code.', created: null, values: kept };
  if (!name) return { error: "Enter the customer's name.", created: null, values: kept };

  const limit = kept.creditLimit ? Math.round(Number(kept.creditLimit) * 100) : null;
  if (kept.creditLimit && !Number.isFinite(limit)) {
    return { error: 'That credit limit is not a number I can read.', created: null, values: kept };
  }

  try {
    await api('/masters/customers', {
      method: 'POST',
      body: {
        code,
        name,
        category: kept.category || null,
        tin: kept.tin || null,
        telephone: kept.phone || null,
        email: kept.email || null,
        state: kept.state || null,
        ...(limit !== null && limit > 0 ? { creditLimitKobo: String(limit) } : {}),
      },
    });
  } catch (caught) {
    return fail(caught, 'Could not save that customer.', kept);
  }

  revalidatePath('/customers');
  return { error: null, created: name };
}

/** Create a store — where stock physically sits. */
export async function createStore(
  _previous: MasterState,
  formData: FormData,
): Promise<MasterState> {
  const code = String(formData.get('code') ?? '').trim().toUpperCase();
  const name = String(formData.get('name') ?? '').trim();
  const type = String(formData.get('type') ?? 'GENERAL');
  const kept = { code, name, type };

  if (!code) return { error: 'Give the store a code.', created: null, values: kept };
  if (!name) return { error: 'Give the store a name.', created: null, values: kept };

  try {
    await api('/masters/warehouses', { method: 'POST', body: { code, name, type } });
  } catch (caught) {
    return fail(caught, 'Could not save that store.', kept);
  }

  revalidatePath('/stores');
  return { error: null, created: name };
}

/** Create a cost centre — what a cost is attributed to. */
export async function createCostCentre(
  _previous: MasterState,
  formData: FormData,
): Promise<MasterState> {
  const code = String(formData.get('code') ?? '').trim().toUpperCase();
  const name = String(formData.get('name') ?? '').trim();
  const parentId = String(formData.get('parentId') ?? '').trim();
  const managerName = String(formData.get('managerName') ?? '').trim();
  const kept = { code, name, parentId, managerName };

  if (!code) return { error: 'Give the cost centre a code.', created: null, values: kept };
  if (!name) return { error: 'Give the cost centre a name.', created: null, values: kept };

  try {
    await api('/masters/cost-centres', {
      method: 'POST',
      body: { code, name, parentId: parentId || null, managerName: managerName || null },
    });
  } catch (caught) {
    return fail(caught, 'Could not save that cost centre.', kept);
  }

  revalidatePath('/admin/cost-centres');
  return { error: null, created: name };
}
