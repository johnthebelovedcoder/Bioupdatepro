import 'server-only';
import { api } from './api';

export interface Period {
  id: string;
  periodNumber: number;
  name: string;
  status: 'OPEN' | 'SOFT_CLOSED' | 'CLOSED' | 'ARCHIVED';
  startDate: string;
  endDate: string;
}

export interface FinancialYear {
  id: string;
  code: string;
  status: string;
  startDate: string;
  endDate: string;
  periods: Period[];
}

export interface OrgContext {
  company: {
    id: string;
    code: string;
    name: string;
    currency: { id: string; code: string; minorUnitScale: number };
  } | null;
  branches: Array<{ id: string; code: string; name: string }>;
  financialYears: FinancialYear[];
}

export function getContext(): Promise<OrgContext> {
  return api<OrgContext>('/reporting/context');
}

/** The year a user most likely wants: the first one still open, else the latest. */
export function defaultYear(context: OrgContext): FinancialYear | null {
  return (
    context.financialYears.find((year) => year.status === 'OPEN') ??
    context.financialYears[0] ??
    null
  );
}
