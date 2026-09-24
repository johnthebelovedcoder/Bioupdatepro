'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Sheet } from './sheet';
import {
  calculateTax,
  closeTaxPeriod,
  fileTaxPeriod,
  generateTaxPeriods,
  setUpTax,
  updateTaxIdentifiers,
  type CalculationState,
  type FlowState,
} from '@/app/(app)/ledger/tax/actions';
import { formatNaira } from '@/lib/money';

const EMPTY: FlowState = { error: null, message: null };

/** Set up a year of filing periods. Idempotent: existing periods are left alone. */
export function GenerateTaxPeriodsForm({ defaultYear }: { defaultYear: number }) {
  const [state, formAction] = useActionState<FlowState, FormData>(generateTaxPeriods, EMPTY);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Set up a year
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Set up a year of tax periods">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="faint">
            Periods follow the filing interval and due day in this company&rsquo;s tax
            configuration. A period that already exists is left untouched, so running this twice
            is harmless.
          </p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}

          <label className="field">
            Tax
            <select name="taxType" defaultValue="VAT">
              <option value="VAT">VAT</option>
              <option value="WHT">Withholding tax (WHT)</option>
            </select>
          </label>

          <label className="field">
            Year
            <input name="year" type="number" min={2000} max={2100} defaultValue={defaultYear} required />
          </label>

          <Submit label="Create periods" pending="Creating…" />
        </form>
      </Sheet>
    </>
  );
}

/**
 * Work out VAT or WHT on an amount, using the posting engine's own codes,
 * rates and rounding. Posts nothing.
 */
export function TaxCalculatorForm({
  taxCodes,
}: {
  taxCodes: Array<{ code: string; name: string; taxType: 'VAT' | 'WHT' }>;
}) {
  const [state, formAction] = useActionState<CalculationState, FormData>(calculateTax, {
    error: null,
    result: null,
  });
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'VAT' | 'WHT'>('VAT');
  const codes = taxCodes.filter((code) => code.taxType === kind);

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Calculator
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Tax calculator">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="faint">
            The same codes, rates and rounding a real posting would use. Nothing is recorded.
          </p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}

          <label className="field">
            Tax
            <select
              name="kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as 'VAT' | 'WHT')}
            >
              <option value="VAT">VAT</option>
              <option value="WHT">Withholding tax (WHT)</option>
            </select>
          </label>

          <label className="field">
            Tax code
            <select name="taxCode" key={kind} defaultValue="" required>
              <option value="" disabled>
                {codes.length === 0 ? `No ${kind} codes set up` : 'Choose a code'}
              </option>
              {codes.map((code) => (
                <option key={code.code} value={code.code}>
                  {code.code} — {code.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            Amount (₦)
            <input name="amount" inputMode="decimal" placeholder="0.00" required />
          </label>

          {kind === 'WHT' ? (
            <label className="field">
              VAT on that amount (₦, optional)
              <input name="vatAmount" inputMode="decimal" placeholder="0.00" />
              <span className="faint">
                Only matters where this company withholds on the amount including VAT.
              </span>
            </label>
          ) : null}

          <label className="field">
            As at
            <input name="on" type="date" />
            <span className="faint">Leave blank for today&rsquo;s rate.</span>
          </label>

          <Submit label="Calculate" pending="Calculating…" />

          {state.result ? (
            <div className="card" style={{ padding: 'var(--sp-4)' }}>
              <dl className="stack" style={{ gap: 'var(--sp-2)', margin: 0 }}>
                <Line label="Taxable base" value={formatNaira(state.result.taxableBaseKobo)} />
                <Line label={state.result.kind} value={formatNaira(state.result.taxKobo)} />
                <Line
                  label={state.result.kind === 'VAT' ? 'Gross' : 'Net paid to supplier'}
                  value={formatNaira(state.result.totalKobo)}
                  strong
                />
              </dl>
              <p className="faint" style={{ marginTop: 'var(--sp-3)', fontSize: 13 }}>
                {state.result.explanation}
              </p>
            </div>
          ) : null}
        </form>
      </Sheet>
    </>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <dt className="muted">{label}</dt>
      <dd className="num" style={{ margin: 0, fontWeight: strong ? 600 : undefined }}>
        {value}
      </dd>
    </div>
  );
}

/** Close a period — refused by the API unless the register agrees with the ledger. */
export function CloseTaxPeriodButton({
  taxPeriodId,
  agrees,
}: {
  taxPeriodId: string;
  agrees: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      <div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || !agrees}
          onClick={() =>
            startTransition(async () => {
              const result = await closeTaxPeriod(taxPeriodId);
              setError(result.error);
              if (!result.error) router.refresh();
            })
          }
        >
          {pending ? 'Closing…' : 'Close period'}
        </button>
      </div>
      {!agrees ? (
        <span className="faint">
          The register and the ledger disagree — see Reconciliation above. A return that cannot
          be tied back to the accounts is not closed.
        </span>
      ) : null}
      {error ? <div className="notice notice-error">{error}</div> : null}
    </div>
  );
}

/** Record the authority's reference for a filed return. Cannot be undone. */
export function FileTaxPeriodForm({ taxPeriodId }: { taxPeriodId: string }) {
  const [state, formAction] = useActionState<FlowState, FormData>(fileTaxPeriod, EMPTY);
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (state.message) {
      setOpen(false);
      router.refresh();
    }
    // Only when a fresh success message arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.message]);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Record as filed
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Record this return as filed">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="taxPeriodId" value={taxPeriodId} />
          <p className="faint">
            This is final. A filed period cannot be reopened here — a correction is a new return
            with the authority.
          </p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}

          <label className="field">
            Filing reference
            <input
              name="filingReference"
              placeholder="The acknowledgement number from the tax authority"
              required
            />
          </label>

          <Submit label="Record as filed" pending="Recording…" />
        </form>
      </Sheet>
    </>
  );
}

function Submit({ label, pending: pendingLabel }: { label: string; pending: string }) {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? pendingLabel : label}
      </button>
    </div>
  );
}

/**
 * First-time tax setup. The statutory rates are not asked for — they are the
 * law — only the withholding basis, which no source document settles, and the
 * company's own tax identifiers.
 */
export function TaxSetupForm() {
  const [state, formAction] = useActionState<FlowState, FormData>(setUpTax, EMPTY);
  const router = useRouter();

  useEffect(() => {
    if (state.message) router.refresh();
    // Only when a fresh success message arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.message]);

  return (
    <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
      <p className="muted" style={{ fontSize: 14 }}>
        This adds VAT at 7.5% (with zero-rated, exempt and out-of-scope codes), the withholding-tax
        categories at their resident rates, and links each to this company&rsquo;s VAT and WHT
        control accounts. Returns are monthly, due on the 21st of the following month.
      </p>

      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}

      <fieldset className="stack" style={{ gap: 'var(--sp-2)', border: 0, padding: 0, margin: 0 }}>
        <legend style={{ marginBottom: 'var(--sp-2)' }}>Withholding tax is worked out on…</legend>
        <label className="row" style={{ gap: 'var(--sp-2)' }}>
          <input type="radio" name="whtBasis" value="NET_OF_VAT" required /> the amount before VAT
        </label>
        <label className="row" style={{ gap: 'var(--sp-2)' }}>
          <input type="radio" name="whtBasis" value="GROSS_INCLUDING_VAT" /> the amount including VAT
        </label>
        <span className="faint">
          The two give different amounts. If you are unsure, ask your tax adviser — your answer is
          recorded against your name.
        </span>
      </fieldset>

      <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <label className="field" style={{ flex: 1, minWidth: 180 }}>
          TIN<span className="faint"> (optional)</span>
          <input name="tin" />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 180 }}>
          VAT registration number<span className="faint"> (optional)</span>
          <input name="vatRegistrationNumber" />
        </label>
      </div>

      <Submit label="Set up tax" pending="Setting up…" />
    </form>
  );
}

/**
 * The company's TIN and VAT registration number, and the one place to
 * correct them. They go on every return, so a wrong one is worth fixing
 * before the first filing — and every change is kept in the audit trail.
 */
export function TaxIdentifiersForm({
  tin,
  vatRegistrationNumber,
}: {
  tin: string | null;
  vatRegistrationNumber: string | null;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(updateTaxIdentifiers, EMPTY);
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (state.message) {
      setOpen(false);
      router.refresh();
    }
    // Only when a fresh success message arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.message]);

  return (
    <>
      <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="faint" style={{ fontSize: 13 }}>
          TIN <strong>{tin ?? 'not set'}</strong> · VAT number{' '}
          <strong>{vatRegistrationNumber ?? 'not set'}</strong>
        </span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
          Edit
        </button>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="Tax identifiers">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="faint">
            As issued by the tax authority. Leave a box empty to clear it. The previous values
            are kept in the audit trail.
          </p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}

          <label className="field">
            TIN
            <input name="tin" defaultValue={tin ?? ''} autoComplete="off" />
          </label>
          <label className="field">
            VAT registration number
            <input
              name="vatRegistrationNumber"
              defaultValue={vatRegistrationNumber ?? ''}
              autoComplete="off"
            />
          </label>

          <Submit label="Save" pending="Saving…" />
        </form>
      </Sheet>
    </>
  );
}
