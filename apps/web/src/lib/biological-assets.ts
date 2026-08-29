import 'server-only';
import { api } from './api';

/**
 * Biological assets, read from the API — §43, §61, §67.
 *
 * Every figure here is a real posted position: a population's carrying value
 * came from an actual `Dr biological asset / Cr GRNI` journal at acquisition,
 * moved by an actual mortality or stage-transfer entry, and revalued only
 * through an approved FVLCTS valuation. Nothing on this page is computed for
 * display and left unposted.
 */

export interface BiologicalAssetGroup {
  id: string;
  code: string;
  speciesKey: string;
  breed: string;
  stage: string;
  population: number;
  currentFvlctsPerUnitKobo: string | null;
  carryingValueKobo: string | null;
  acquisitionCostKobo: string;
  acquisitionPosted: boolean;
}

export interface RollForward {
  groupCode: string;
  stage: string;
  population: number;
  currentFvlctsPerUnitKobo: string;
  openingBaKobo: string;
  mortalityLossKobo: string;
  growthGainKobo: string;
  closingBaKobo: string;
  differenceKobo: string;
  reconciled: boolean;
}

export interface BiologicalAssetValuation {
  id: string;
  groupCode: string;
  stage: string;
  valuationDate: string;
  closingQuantity: number;
  priorFvlctsPerUnitKobo: string;
  currentFvlctsPerUnitKobo: string;
  direction: 'GAIN' | 'LOSS';
  gainLossKobo: string;
  evidenceReference: string;
  status: string;
  preparedBy: string;
  journalEntryId: string | null;
}

export async function getBiologicalAssetGroups(): Promise<BiologicalAssetGroup[]> {
  return safe<BiologicalAssetGroup[]>('/biological-assets/groups', []);
}

export async function getRollForward(groupId: string): Promise<RollForward | null> {
  try {
    return await api<RollForward>(`/biological-assets/groups/${groupId}/roll-forward`);
  } catch {
    return null;
  }
}

export async function getValuations(): Promise<BiologicalAssetValuation[]> {
  return safe<BiologicalAssetValuation[]>('/biological-assets/valuations', []);
}

export interface MarketPrice {
  speciesKey: string;
  breed: string;
  marketPricePerUnitKobo: string;
  costsToSellPerUnitKobo: string;
  evidenceReference: string;
  effectiveFrom: string;
}

/**
 * The governed market price list (US-897-011) — what the valuation form
 * prefills its market price / cost-to-sell fields from. Empty rather than
 * thrown for a company that has not priced anything yet: the form's own
 * fields stay free-typed either way.
 */
export async function getMarketPrices(): Promise<MarketPrice[]> {
  return safe<MarketPrice[]>('/biological-assets/market-prices', []);
}

async function safe<T>(path: string, fallback: T): Promise<T> {
  try {
    return await api<T>(path);
  } catch {
    return fallback;
  }
}
