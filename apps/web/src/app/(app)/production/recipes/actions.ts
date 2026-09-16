'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

/**
 * Recipes and their bills of material — the missing half of Processing
 * orders. `RecipeService` could version, activate and cost a recipe, but
 * nothing anywhere ever created the recipe itself or put a component on a
 * draft version, so the "raise a processing order" screen always offered an
 * empty Recipe picker. See the API-side header on `RecipeService.create` and
 * `.addComponent` for the fuller story.
 */

export interface CreateRecipeState {
  error: string | null;
}

/**
 * A recipe and its first draft version, in one step — a recipe with no
 * version is not something the raise-a-recipe form has any use showing
 * separately, and splitting the two into a two-page wizard would just be two
 * chances to abandon halfway through.
 */
export async function createRecipe(
  _previous: CreateRecipeState,
  formData: FormData,
): Promise<CreateRecipeState> {
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const outputItemId = String(formData.get('outputItemId') ?? '');
  const batchSize = String(formData.get('batchSize') ?? '').trim();

  if (!code) return { error: 'Give the recipe a code.' };
  if (!name) return { error: 'Give the recipe a name.' };
  if (!outputItemId) return { error: 'Choose what this recipe produces.' };
  if (!batchSize || Number(batchSize) <= 0) {
    return { error: 'Enter how much one run of this recipe yields.' };
  }

  let recipeId: string;
  try {
    const recipe = await api<{ id: string }>('/masters/recipes', {
      method: 'POST',
      body: { code, name, outputItemId },
    });
    recipeId = recipe.id;
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not create that recipe.' };
  }

  try {
    await api('/masters/recipes/versions', {
      method: 'POST',
      body: {
        recipeId,
        batchSize,
        effectiveFrom: new Date().toISOString().slice(0, 10),
      },
    });
  } catch (caught) {
    // The recipe itself was created and is real; only its first draft
    // version failed. Send them to it rather than losing that.
    return {
      error:
        (caught instanceof ApiError ? caught.message : 'Could not start its first version.') +
        ' The recipe was created — open it below to try the version again.',
    };
  }

  revalidatePath('/production/recipes');
  redirect(`/production/recipes/${recipeId}`);
}

export interface AddComponentState {
  error: string | null;
}

export async function addComponent(
  _previous: AddComponentState,
  formData: FormData,
): Promise<AddComponentState> {
  const recipeId = String(formData.get('recipeId') ?? '');
  const recipeVersionId = String(formData.get('recipeVersionId') ?? '');
  const componentItemId = String(formData.get('componentItemId') ?? '');
  const quantityPerBatch = String(formData.get('quantityPerBatch') ?? '').trim();
  const unitOfMeasureCode = String(formData.get('unitOfMeasureCode') ?? '');
  const wastagePercent = String(formData.get('wastagePercent') ?? '').trim();
  const optional = formData.get('optional') === 'on';

  if (!componentItemId) return { error: 'Choose what this line consumes.' };
  if (!quantityPerBatch || Number(quantityPerBatch) <= 0) {
    return { error: 'Enter how much this line uses, per batch.' };
  }

  try {
    await api(`/masters/recipes/versions/${recipeVersionId}/components`, {
      method: 'POST',
      body: {
        componentItemId,
        quantityPerBatch,
        unitOfMeasureCode,
        ...(wastagePercent ? { wastagePercent } : {}),
        optional,
      },
    });
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not add that component.' };
  }

  revalidatePath(`/production/recipes/${recipeId}`);
  return { error: null };
}

export interface AddRoutingOperationState {
  error: string | null;
}

/** A labour/machine standard on a recipe version — US-897-014. */
export async function addRoutingOperation(
  _previous: AddRoutingOperationState,
  formData: FormData,
): Promise<AddRoutingOperationState> {
  const recipeId = String(formData.get('recipeId') ?? '');
  const recipeVersionId = String(formData.get('recipeVersionId') ?? '');
  const costCentreId = String(formData.get('costCentreId') ?? '');
  const costPoolId = String(formData.get('costPoolId') ?? '');
  const operationName = String(formData.get('operationName') ?? '').trim();
  const resourceType = String(formData.get('resourceType') ?? '');
  const setupHours = String(formData.get('setupHours') ?? '').trim();
  const runHoursPerUnit = String(formData.get('runHoursPerUnit') ?? '').trim();

  if (!operationName) return { error: 'Name the operation.' };
  if (!costCentreId) return { error: 'Choose which cost centre this operation belongs to.' };
  if (!costPoolId) return { error: 'Choose which cost pool absorbs this operation’s overhead.' };
  if (!resourceType) return { error: 'Say whether this is a labour or a machine standard.' };

  try {
    await api(`/masters/recipes/versions/${recipeVersionId}/routing`, {
      method: 'POST',
      body: {
        costCentreId,
        costPoolId,
        operationName,
        resourceType,
        setupHours: setupHours || '0',
        runHoursPerUnit: runHoursPerUnit || '0',
      },
    });
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not add that operation.' };
  }

  revalidatePath(`/production/recipes/${recipeId}`);
  return { error: null };
}

export interface ActivateVersionState {
  error: string | null;
}

export async function activateVersion(
  _previous: ActivateVersionState,
  formData: FormData,
): Promise<ActivateVersionState> {
  const recipeId = String(formData.get('recipeId') ?? '');
  const recipeVersionId = String(formData.get('recipeVersionId') ?? '');

  try {
    await api(`/masters/recipes/versions/${recipeVersionId}/activate`, { method: 'POST' });
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not activate that version.' };
  }

  revalidatePath(`/production/recipes/${recipeId}`);
  revalidatePath('/production/recipes');
  revalidatePath('/production');
  return { error: null };
}
