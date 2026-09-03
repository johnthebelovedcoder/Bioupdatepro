'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import { getContext, defaultYear } from '@/lib/org';
import type { SessionUser } from '@/lib/session';

export interface FlowState {
  error: string | null;
  message: string | null;
}

function fail(caught: unknown, fallback: string): FlowState {
  return { error: caught instanceof ApiError ? caught.message : fallback, message: null };
}

interface LineInput {
  glAccountId: string;
  description: string;
  debitKobo?: string;
  creditKobo?: string;
  costCentreId?: string | null;
}

function parseLines(raw: string): LineInput[] {
  const parsed: unknown = JSON.parse(raw || '[]');
  if (!Array.isArray(parsed)) return [];
  return parsed as LineInput[];
}

async function periodFor(date: Date) {
  const context = await getContext();
  const year = context.financialYears.find((y) =>
    y.periods.some((p) => date >= new Date(p.startDate) && date <= new Date(p.endDate)),
  );
  const period = year?.periods.find(
    (p) => date >= new Date(p.startDate) && date <= new Date(p.endDate),
  );
  return { context, year, period };
}

/** Raise a manual journal and send it for approval — no separate draft step exposed here. */
export async function createManualJournal(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const journalTypeCode = String(formData.get('journalTypeCode') ?? '').trim();
  const reasonCode = String(formData.get('reasonCode') ?? '').trim();
  const reference = String(formData.get('reference') ?? '').trim();
  const journalDateRaw = String(formData.get('journalDate') ?? '').trim();
  const narration = String(formData.get('narration') ?? '').trim();
  const linesRaw = String(formData.get('lines') ?? '[]');

  if (!journalTypeCode) return { error: 'Choose a journal type.', message: null };
  if (!reasonCode) return { error: 'Choose a reason for this journal.', message: null };
  if (!reference) return { error: 'Give this journal a reference.', message: null };
  if (!journalDateRaw) return { error: 'Choose a journal date.', message: null };
  if (!narration) return { error: 'Say what this journal is for.', message: null };

  const lines = parseLines(linesRaw).filter((l) => l.glAccountId && (l.debitKobo || l.creditKobo));
  if (lines.length < 2) return { error: 'A journal needs at least two lines.', message: null };

  const totalDebit = lines.reduce((s, l) => s + BigInt(l.debitKobo || '0'), 0n);
  const totalCredit = lines.reduce((s, l) => s + BigInt(l.creditKobo || '0'), 0n);
  if (totalDebit !== totalCredit) {
    return { error: `Debits (${totalDebit}) and credits (${totalCredit}) must balance exactly.`, message: null };
  }

  const journalDate = new Date(journalDateRaw);
  const { context, year, period } = await periodFor(journalDate);
  if (!context.company) return { error: 'No company is set up yet.', message: null };
  if (!year || !period) return { error: 'No open financial period covers that date.', message: null };
  const branch = context.branches[0];
  if (!branch) return { error: 'This company has no active branch.', message: null };

  const me = await api<SessionUser>('/auth/me');

  try {
    const journal = await api<{ id: string; reference: string }>('/journal/create', {
      method: 'POST',
      body: {
        companyId: context.company.id,
        journalTypeCode,
        reasonCode,
        reference,
        journalDate: journalDate.toISOString(),
        narration,
        branchId: branch.id,
        financialYearId: year.id,
        financialPeriodId: period.id,
        currencyId: context.company.currency.id,
        lines,
        actor: { userId: me.userId, roles: me.roles },
      },
    });

    await api('/journal/submit', {
      method: 'POST',
      body: {
        manualJournalId: journal.id,
        actor: { userId: me.userId, roles: me.roles },
      },
    });

    revalidatePath('/finance/journals');
    return { error: null, message: `${journal.reference} raised and sent for approval.` };
  } catch (caught) {
    return fail(caught, 'Could not raise that journal.');
  }
}

/**
 * A recurring template — its own lines carry the flat per-run debit/credit,
 * unchanged run to run (§3's own "Manual" basis default, see the model's
 * doc comment for why `basis` is display/audit only).
 */
export async function createRecurringJournal(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const narration = String(formData.get('narration') ?? '').trim();
  const frequency = String(formData.get('frequency') ?? '').trim();
  const basis = String(formData.get('basis') ?? '').trim();
  const dayOfMonth = Number(formData.get('dayOfMonth') ?? 1);
  const startDateRaw = String(formData.get('startDate') ?? '').trim();
  const endDateRaw = String(formData.get('endDate') ?? '').trim();
  const linesRaw = String(formData.get('lines') ?? '[]');

  if (!code) return { error: 'Give this template a code.', message: null };
  if (!name) return { error: 'Name this template.', message: null };
  if (!narration) return { error: 'Say what this recurring journal is for.', message: null };
  if (!frequency) return { error: 'Choose how often this runs.', message: null };
  if (!startDateRaw) return { error: 'Choose a start date.', message: null };

  const lines = parseLines(linesRaw).filter((l) => l.glAccountId && (l.debitKobo || l.creditKobo));
  if (lines.length < 2) return { error: 'A journal needs at least two lines.', message: null };

  const totalDebit = lines.reduce((s, l) => s + BigInt(l.debitKobo || '0'), 0n);
  const totalCredit = lines.reduce((s, l) => s + BigInt(l.creditKobo || '0'), 0n);
  if (totalDebit !== totalCredit) {
    return { error: `Debits (${totalDebit}) and credits (${totalCredit}) must balance exactly.`, message: null };
  }

  const context = await getContext();
  if (!context.company) return { error: 'No company is set up yet.', message: null };
  const branch = context.branches[0];
  if (!branch) return { error: 'This company has no active branch.', message: null };
  const me = await api<SessionUser>('/auth/me');

  try {
    await api('/journal/recurring', {
      method: 'POST',
      body: {
        journalTypeCode: 'REC',
        code,
        name,
        narration,
        branchId: branch.id,
        currencyId: context.company.currency.id,
        frequency,
        dayOfMonth,
        basis: basis || undefined,
        startDate: new Date(startDateRaw).toISOString(),
        endDate: endDateRaw ? new Date(endDateRaw).toISOString() : undefined,
        lines,
        actorId: me.userId,
      },
    });
  } catch (caught) {
    return fail(caught, 'Could not create that recurring journal.');
  }

  revalidatePath('/finance/journals');
  return { error: null, message: `${code} created — next due ${startDateRaw}.` };
}

/** Generate every template whose next run date has arrived — drafts only, each still needs approval. */
export async function generateDueRecurring(): Promise<FlowState> {
  const context = await getContext();
  if (!context.company) return { error: 'No company is set up yet.', message: null };
  const me = await api<SessionUser>('/auth/me');

  try {
    const result = await api<{ generated: unknown[]; skipped: unknown[] }>('/journal/recurring/generate', {
      method: 'POST',
      body: { actorId: me.userId },
    });
    revalidatePath('/finance/journals');
    return {
      error: null,
      message: `${result.generated.length} journal${result.generated.length === 1 ? '' : 's'} generated, ${result.skipped.length} skipped (not yet due).`,
    };
  } catch (caught) {
    return fail(caught, 'Could not generate due journals.');
  }
}
