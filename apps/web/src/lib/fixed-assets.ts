import 'server-only';
import { api } from './api';

export interface FixedAssetRow {
  id: string;
  assetNumber: string;
  name: string;
  assetClass: string;
  acquisitionDate: string;
  costKobo: string;
  usefulLifeMonths: number;
  costCentre: string | null;
  accumulatedDepreciationKobo: string;
  netBookValueKobo: string;
  status: string;
  disposedOn: string | null;
  fullyDepreciated: boolean;
  pendingTransactionId: string | null;
}

export async function getFixedAssets(): Promise<FixedAssetRow[]> {
  try {
    return await api<FixedAssetRow[]>('/fixed-assets/assets');
  } catch {
    return [];
  }
}
