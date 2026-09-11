'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import { parseNairaToKobo } from '@/lib/money';

export interface FlowState {
  error: string | null;
  message: string | null;
}

function fail(caught: unknown, fallback: string): FlowState {
  return { error: caught instanceof ApiError ? caught.message : fallback, message: null };
}

/** Raise a processing order (SnailPro/PoultryPro) against a harvest with no order yet. */
export async function createFromHarvest(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const harvestRecordId = String(formData.get('harvestRecordId') ?? '');
  const recipeVersionId = String(formData.get('recipeVersionId') ?? '');
  const orderNumber = String(formData.get('orderNumber') ?? '').trim();
  const plannedOutputQuantity = String(formData.get('plannedOutputQuantity') ?? '').trim();

  if (!harvestRecordId) return { error: 'Choose which harvest this order processes.', message: null };
  if (!recipeVersionId) return { error: 'Choose a recipe.', message: null };
  if (!orderNumber) return { error: 'Give the order a number.', message: null };
  if (!plannedOutputQuantity || Number(plannedOutputQuantity) <= 0) {
    return { error: 'Enter a planned output quantity greater than zero.', message: null };
  }

  try {
    await api('/production-orders', {
      method: 'POST',
      body: {
        harvestRecordId,
        recipeVersionId,
        // Unused by the service (the store is decided per-item at issue
        // time from each item's own default), but the endpoint requires it.
        warehouseId: '00000000-0000-0000-0000-000000000000',
        orderNumber,
        plannedOutputQuantity,
      },
    });
  } catch (caught) {
    return fail(caught, 'Could not raise that order.');
  }

  revalidatePath('/production');
  return { error: null, message: `${orderNumber} raised as a draft.` };
}

/** Raise a Feed Mill order — no harvest or biological population involved. */
export async function createFeedOrder(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const branchId = String(formData.get('branchId') ?? '');
  const farmId = String(formData.get('farmId') ?? '');
  const recipeVersionId = String(formData.get('recipeVersionId') ?? '');
  const orderNumber = String(formData.get('orderNumber') ?? '').trim();
  const plannedOutputQuantity = String(formData.get('plannedOutputQuantity') ?? '').trim();

  if (!farmId) return { error: 'Choose which farm this feed is for.', message: null };
  if (!recipeVersionId) return { error: 'Choose a recipe.', message: null };
  if (!orderNumber) return { error: 'Give the order a number.', message: null };
  if (!plannedOutputQuantity || Number(plannedOutputQuantity) <= 0) {
    return { error: 'Enter a planned output quantity greater than zero.', message: null };
  }

  try {
    await api('/production-orders/feed', {
      method: 'POST',
      body: {
        branchId,
        farmId,
        warehouseId: '00000000-0000-0000-0000-000000000000',
        recipeVersionId,
        orderNumber,
        plannedOutputQuantity,
      },
    });
  } catch (caught) {
    return fail(caught, 'Could not raise that feed order.');
  }

  revalidatePath('/production');
  return { error: null, message: `${orderNumber} raised as a draft.` };
}

/** Send a draft order for approval — the same maker-checker every other document uses. */
export async function submitOrder(id: string): Promise<FlowState> {
  try {
    await api(`/production-orders/${id}/submit`, { method: 'POST' });
  } catch (caught) {
    return fail(caught, 'Could not submit that order.');
  }
  revalidatePath(`/production/${id}`);
  revalidatePath('/production');
  return { error: null, message: 'Submitted for approval.' };
}

/** Issue the biological input and packaging components to WIP. */
export async function issueOrder(id: string): Promise<FlowState> {
  try {
    await api(`/production-orders/${id}/issue`, { method: 'POST' });
  } catch (caught) {
    return fail(caught, 'Could not issue materials for that order.');
  }
  revalidatePath(`/production/${id}`);
  revalidatePath('/production');
  return { error: null, message: 'Materials issued to work-in-progress.' };
}

/** Post standard absorption and the actual labour/overhead conversion cost. */
export async function confirmConversion(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const id = String(formData.get('productionOrderId') ?? '');
  const standard = parseNairaToKobo(String(formData.get('standardConversionCost') ?? ''));
  const labour = parseNairaToKobo(String(formData.get('actualLabourCost') ?? '')) ?? 0n;
  const overhead = parseNairaToKobo(String(formData.get('actualOverheadCost') ?? '')) ?? 0n;

  if (standard === null) return { error: 'Enter the standard conversion cost.', message: null };

  try {
    await api(`/production-orders/${id}/confirm-conversion`, {
      method: 'POST',
      body: {
        standardConversionCostKobo: standard.toString(),
        actualLabourCostKobo: labour.toString(),
        actualOverheadCostKobo: overhead.toString(),
      },
    });
  } catch (caught) {
    return fail(caught, 'Could not confirm conversion.');
  }

  revalidatePath(`/production/${id}`);
  return { error: null, message: 'Conversion confirmed. The order is now in production.' };
}

/** Claim an abnormal processing loss — the recipe's tolerance decides how much of it actually posts. */
export async function recordLoss(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const id = String(formData.get('productionOrderId') ?? '');
  const quantity = String(formData.get('quantity') ?? '').trim();
  const cost = parseNairaToKobo(String(formData.get('cost') ?? ''));
  const reason = String(formData.get('reason') ?? '').trim();

  if (!quantity || Number(quantity) <= 0) return { error: 'Enter a loss quantity greater than zero.', message: null };
  if (cost === null) return { error: 'Enter the cost of the loss.', message: null };
  if (!reason) return { error: 'Say why — the claim needs a reason.', message: null };

  try {
    await api(`/production-orders/${id}/loss`, {
      method: 'POST',
      body: { quantity, costKobo: cost.toString(), reason },
    });
  } catch (caught) {
    return fail(caught, 'Could not record that loss.');
  }

  revalidatePath(`/production/${id}`);
  return { error: null, message: 'Loss recorded.' };
}

interface OutputLine {
  itemId: string;
  outputType: 'MAIN' | 'BY_PRODUCT';
  quantity: string;
  salePricePerUnitKobo?: string;
  costsToSellPerUnitKobo?: string;
  weight?: string;
}

/** Receive the order's finished output(s), splitting its residual WIP cost across them. */
export async function recordOutputs(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const id = String(formData.get('productionOrderId') ?? '');
  const method = String(formData.get('method') ?? '');
  const warehouseId = String(formData.get('warehouseId') ?? '');
  const mainItemId = String(formData.get('mainItemId') ?? '');
  const mainQuantity = String(formData.get('mainQuantity') ?? '').trim();

  if (method !== 'NRV' && method !== 'WEIGHT') {
    return { error: 'Choose an allocation method.', message: null };
  }
  if (!warehouseId) return { error: 'Choose which store receives the output.', message: null };
  if (!mainQuantity || Number(mainQuantity) <= 0) {
    return { error: 'Enter the main output quantity.', message: null };
  }

  const outputs: OutputLine[] = [];

  const lineFor = (
    itemId: string,
    outputType: 'MAIN' | 'BY_PRODUCT',
    quantity: string,
    salePrice: string,
    costsToSell: string,
    weight: string,
  ): OutputLine | { error: string } => {
    const line: OutputLine = { itemId, outputType, quantity };
    if (method === 'NRV') {
      const price = parseNairaToKobo(salePrice);
      if (price === null) return { error: `Enter a sale price for the ${outputType === 'MAIN' ? 'main output' : 'by-product'}.` };
      line.salePricePerUnitKobo = price.toString();
      const costs = parseNairaToKobo(costsToSell);
      if (costs !== null) line.costsToSellPerUnitKobo = costs.toString();
    } else {
      if (!weight || Number(weight) <= 0) {
        return { error: `Enter a weight for the ${outputType === 'MAIN' ? 'main output' : 'by-product'}.` };
      }
      line.weight = weight;
    }
    return line;
  };

  const main = lineFor(
    mainItemId,
    'MAIN',
    mainQuantity,
    String(formData.get('mainSalePrice') ?? ''),
    String(formData.get('mainCostsToSell') ?? ''),
    String(formData.get('mainWeight') ?? ''),
  );
  if ('error' in main) return { error: main.error, message: null };
  outputs.push(main);

  for (let i = 1; i <= 2; i++) {
    const itemId = String(formData.get(`byProductItemId${i}`) ?? '');
    const quantity = String(formData.get(`byProductQuantity${i}`) ?? '').trim();
    if (!itemId || !quantity) continue;
    const line = lineFor(
      itemId,
      'BY_PRODUCT',
      quantity,
      String(formData.get(`byProductSalePrice${i}`) ?? ''),
      String(formData.get(`byProductCostsToSell${i}`) ?? ''),
      String(formData.get(`byProductWeight${i}`) ?? ''),
    );
    if ('error' in line) return { error: line.error, message: null };
    outputs.push(line);
  }

  try {
    await api(`/production-orders/${id}/outputs`, {
      method: 'POST',
      body: { method, warehouseId, outputs },
    });
  } catch (caught) {
    return fail(caught, 'Could not record those outputs.');
  }

  revalidatePath(`/production/${id}`);
  return { error: null, message: 'Outputs received. The order is complete.' };
}

/** Close the order: compare actual conversion cost against standard and post the variance. */
export async function settleOrder(id: string): Promise<FlowState> {
  try {
    await api(`/production-orders/${id}/settle`, { method: 'POST' });
  } catch (caught) {
    return fail(caught, 'Could not settle that order.');
  }
  revalidatePath(`/production/${id}`);
  revalidatePath('/production');
  return { error: null, message: 'Settled.' };
}
