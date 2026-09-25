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
  /** PCR-031: the processing line this machine serves, if any. */
  processingCycle: 'SNAILPRO' | 'POULTRYPRO' | 'FEED_MILL' | null;
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

export interface MachineHoursRow {
  assetId: string;
  processingCycle: 'SNAILPRO' | 'POULTRYPRO' | 'FEED_MILL';
  hours: string;
}

/** PCR-031 — hours each machine ran on each processing line in a period. */
export async function getMachineHours(periodId: string): Promise<MachineHoursRow[]> {
  try {
    return await api<MachineHoursRow[]>(`/fixed-assets/machine-hours?periodId=${encodeURIComponent(periodId)}`);
  } catch {
    return [];
  }
}
