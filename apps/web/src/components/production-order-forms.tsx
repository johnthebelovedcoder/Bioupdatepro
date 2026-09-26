'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import {
  settleWithReason,
  issueWithQuantities,
  confirmConversion,
  recordLoss,
  recordOutputs,
  recordIntake,
  recordQualityTest,
  decideQualityTest,
  type FlowState,
} from '@/app/(app)/production/actions';
import type { Warehouse } from '@/lib/masters';

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * APPROVED → RELEASED: issue each line. The standard quantity is filled in;
 * change it to what actually left the store. WIP takes the standard either
 * way, and the difference is a usage variance (PCR-052, POL-004).
 */
export function IssueMaterialsForm({
  orderId,
  lines,
}: {
  orderId: string;
  lines: Array<{ id: string; label: string; standardQuantity: string }>;
}) {
  const [state, action] = useActionState<FlowState, FormData>(issueWithQuantities, { error: null, message: null });
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <input type="hidden" name="productionOrderId" value={orderId} />
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {lines.length > 0 ? (
        <div className="grid-auto">
          {lines.map((line) => (
            <label key={line.id} className="field">
              {line.label}
              <input name={`qty:${line.id}`} type="number" step="0.001" min="0" defaultValue={Number(line.standardQuantity)} />
              <span className="faint">Standard {Number(line.standardQuantity).toLocaleString()}</span>
            </label>
          ))}
        </div>
      ) : null}
      <div>
        <Submit label="Issue materials" pendingLabel="Issuing…" />
      </div>
    </form>
  );
}

/**
 * COMPLETED → settled. Beyond the year's variance tolerance the order needs
 * a reason, which is kept on the order and in the audit trail.
 */
export function SettleOrderForm({ orderId, needsReason, summary }: { orderId: string; needsReason: boolean; summary: string | null }) {
  const [state, action] = useActionState<FlowState, FormData>(settleWithReason, { error: null, message: null });
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <input type="hidden" name="productionOrderId" value={orderId} />
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {needsReason ? (
        <>
          <div className="notice notice-warning">{summary}</div>
          <label className="field">
            Why is the variance this large?
            <textarea name="varianceReason" rows={2} required placeholder="e.g. Maize price rose in June; standard due for revision" />
          </label>
        </>
      ) : null}
      <div>
        <Submit label="Settle" pendingLabel="Settling…" />
      </div>
    </form>
  );
}

/** RELEASED → IN_PRODUCTION: post standard absorption plus the actual labour/overhead cost. */
export function ConfirmConversionForm({
  orderId,
  operations = [],
}: {
  orderId: string;
  /** The order's routing: with one, the standard is actual hours × approved rates (PCR-053). */
  operations?: Array<{ name: string; standardHours: string; ratePerHourKobo: string }>;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(confirmConversion, {
    error: null,
    message: null,
  });

  return (
    <form action={formAction} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <input type="hidden" name="productionOrderId" value={orderId} />
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}

      {operations.length > 0 ? (
        <>
          <p className="faint" style={{ fontSize: 13 }}>
            The standard is worked out from the routing: the hours each operation actually took, at its cost pool&rsquo;s
            approved rate. Leave an operation blank to use its standard hours.
          </p>
          {operations.map((op) => (
            <label key={op.name} className="field">
              {op.name} — hours (standard {Number(op.standardHours).toLocaleString('en-NG')}, ₦
              {(Number(op.ratePerHourKobo) / 100).toLocaleString('en-NG')}/h)
              <input name={`hours:${op.name}`} type="number" step="0.01" min="0" placeholder={op.standardHours} />
            </label>
          ))}
        </>
      ) : (
        <label className="field">
          Standard conversion cost (₦)
          <input name="standardConversionCost" type="number" step="0.01" min="0" required />
          <span className="faint">This recipe has no routing. Set one up (Production → Recipes) and this is worked out for you.</span>
        </label>
      )}
      <label className="field">
        Actual labour cost (₦)
        <input name="actualLabourCost" type="number" step="0.01" min="0" defaultValue="0" />
      </label>
      <label className="field">
        Actual overhead cost (₦)
        <input name="actualOverheadCost" type="number" step="0.01" min="0" defaultValue="0" />
      </label>

      <Submit label="Confirm conversion" pendingLabel="Confirming…" />
    </form>
  );
}

/** Optional, while IN_PRODUCTION: claim an abnormal loss — the recipe's own tolerance decides how much posts. */
export function RecordLossForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState<FlowState, FormData>(recordLoss, {
    error: null,
    message: null,
  });

  return (
    <form action={formAction} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <input type="hidden" name="productionOrderId" value={orderId} />
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}

      <label className="field">
        Quantity lost
        <input name="quantity" type="number" step="0.001" min="0.001" required />
      </label>
      <label className="field">
        Cost of the loss (₦)
        <input name="cost" type="number" step="0.01" min="0" required />
      </label>
      <label className="field">
        Reason
        <input name="reason" placeholder="Spoilage, breakage, a failed batch" required />
      </label>

      <Submit label="Record loss" pendingLabel="Recording…" />
    </form>
  );
}

/** IN_PRODUCTION → COMPLETED: receive the finished output(s), splitting residual WIP cost across them. */
export function RecordOutputsForm({
  orderId,
  mainItemId,
  mainItemLabel,
  warehouses,
  byProductItems,
  coldStore = false,
}: {
  orderId: string;
  mainItemId: string;
  mainItemLabel: string;
  warehouses: Warehouse[];
  byProductItems: Array<{ id: string; code: string; name: string }>;
  /** Poultry processing: grade, expiry and cold-store temperature are required (handbook §29). */
  coldStore?: boolean;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(recordOutputs, {
    error: null,
    message: null,
  });
  const [byProductCount, setByProductCount] = useState(0);

  return (
    <form action={formAction} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <input type="hidden" name="productionOrderId" value={orderId} />
      <input type="hidden" name="mainItemId" value={mainItemId} />
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}

      <p className="faint" style={{ fontSize: 13 }}>
        The order&rsquo;s cost is shared between its outputs by the company&rsquo;s one released method — relative
        sales value at split-off — using the approved selling prices under{' '}
        <a href="/production/joint-cost">Joint-cost prices</a>. Weigh everything in kilograms: what came out, and what was
        lost along the way, must add up to what went in.
      </p>

      <label className="field">
        Receiving store
        <select name="warehouseId" defaultValue="" required>
          <option value="" disabled>
            Where the output goes
          </option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        {mainItemLabel} (kg)
        <input name="mainQuantity" type="number" step="0.001" min="0.001" required />
      </label>
      <ColdStoreFields prefix="main" required={coldStore} />

      {[...Array(byProductCount)].map((_, index) => {
        const n = index + 1;
        return (
          <div key={n} className="grid-auto">
            <label className="field">
              By-product {n}
              <select name={`byProductItemId${n}`} defaultValue="">
                <option value="">— none —</option>
                {byProductItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code} — {i.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Kilograms
              <input name={`byProductQuantity${n}`} type="number" step="0.001" min="0" />
            </label>
            <ColdStoreFields prefix={`byProduct${n}`} required={false} />
          </div>
        );
      })}

      {byProductCount < 2 ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setByProductCount((c) => c + 1)}>
          + Add a by-product
        </button>
      ) : null}

      <label className="field">
        Normal process loss (kg)
        <input name="normalLossQuantity" type="number" step="0.001" min="0" />
        <span className="faint">Blood, water, trimmings — the ordinary loss. Leave blank and the order tells you what it should be.</span>
      </label>

      <Submit label="Record outputs" pendingLabel="Recording…" />
    </form>
  );
}

/** Grade, expiry and cold-store temperature of an output lot (handbook §29). */
function ColdStoreFields({ prefix, required }: { prefix: string; required: boolean }) {
  return (
    <div className="grid-auto">
      <label className="field">
        Grade{required ? '' : ' (optional)'}
        <input name={`${prefix}Grade`} placeholder="A" required={required} />
      </label>
      <label className="field">
        Use by{required ? '' : ' (optional)'}
        <input name={`${prefix}Expiry`} type="date" required={required} />
      </label>
      <label className="field">
        Stored at °C{required ? '' : ' (optional)'}
        <input name={`${prefix}Temp`} type="number" step="0.1" placeholder="-18" required={required} />
      </label>
    </div>
  );
}

/**
 * Poultry plant intake (handbook §29): what reached the plant from the catch.
 * Dead-on-arrival and condemned birds then need an abnormal-loss claim.
 */
export function PlantIntakeForm({
  orderId,
  caught,
  current,
}: {
  orderId: string;
  caught: { count: number; weightKg: string };
  current: {
    plantReceivedCount: number | null;
    plantReceivedWeightKg: string | null;
    deadOnArrivalCount: number | null;
    deadOnArrivalWeightKg: string | null;
    condemnedCount: number | null;
    condemnedWeightKg: string | null;
    condemnationReason: string | null;
    intakeInspectedBy: string | null;
  };
}) {
  const [state, action] = useActionState<FlowState, FormData>(recordIntake, { error: null, message: null });
  const num = (v: string | number | null) => (v === null ? undefined : Number(v));
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <input type="hidden" name="productionOrderId" value={orderId} />
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}
      <p className="faint" style={{ fontSize: 13 }}>
        The catch was {caught.count.toLocaleString('en-NG')} birds, {Number(caught.weightKg).toLocaleString('en-NG')} kg live.
      </p>
      <div className="grid-auto">
        <label className="field">
          Birds received
          <input name="plantReceivedCount" type="number" min="0" step="1" max={caught.count} defaultValue={num(current.plantReceivedCount) ?? caught.count} required />
        </label>
        <label className="field">
          Live weight received (kg)
          <input name="plantReceivedWeightKg" type="number" min="0" step="0.001" defaultValue={num(current.plantReceivedWeightKg) ?? Number(caught.weightKg)} required />
        </label>
      </div>
      <div className="grid-auto">
        <label className="field">
          Dead on arrival
          <input name="deadOnArrivalCount" type="number" min="0" step="1" defaultValue={num(current.deadOnArrivalCount) ?? 0} />
        </label>
        <label className="field">
          Their weight (kg)
          <input name="deadOnArrivalWeightKg" type="number" min="0" step="0.001" defaultValue={num(current.deadOnArrivalWeightKg) ?? 0} />
        </label>
      </div>
      <div className="grid-auto">
        <label className="field">
          Condemned by the vet
          <input name="condemnedCount" type="number" min="0" step="1" defaultValue={num(current.condemnedCount) ?? 0} />
        </label>
        <label className="field">
          Their weight (kg)
          <input name="condemnedWeightKg" type="number" min="0" step="0.001" defaultValue={num(current.condemnedWeightKg) ?? 0} />
        </label>
      </div>
      <div className="grid-auto">
        <label className="field">
          Why condemned
          <input name="condemnationReason" defaultValue={current.condemnationReason ?? ''} placeholder="Septicaemia, bruising, ascites" />
        </label>
        <label className="field">
          Vet or inspector
          <input name="inspectedBy" defaultValue={current.intakeInspectedBy ?? ''} />
        </label>
      </div>
      <div>
        <Submit label={current.plantReceivedCount === null ? 'Record intake' : 'Correct intake'} pendingLabel="Recording…" />
      </div>
    </form>
  );
}

/** A feed batch's sample against its quality limits (handbook §26). */
export function QualityTestForm({ orderId }: { orderId: string }) {
  const [state, action] = useActionState<FlowState, FormData>(recordQualityTest, { error: null, message: null });
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <input type="hidden" name="productionOrderId" value={orderId} />
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}
      <div className="grid-auto">
        <label className="field">
          Sampled on
          <input name="sampledOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
        </label>
        <label className="field">
          Protein %
          <input name="proteinPercent" type="number" step="0.01" min="0" />
        </label>
        <label className="field">
          Moisture %
          <input name="moisturePercent" type="number" step="0.01" min="0" />
        </label>
        <label className="field">
          Aflatoxin ppb
          <input name="aflatoxinPpb" type="number" step="0.01" min="0" />
        </label>
      </div>
      <label className="field">
        Contamination seen (leave blank if none)
        <input name="contaminationNote" placeholder="Mould, insects, foreign matter" />
      </label>
      <div>
        <Submit label="Record test" pendingLabel="Recording…" />
      </div>
    </form>
  );
}

/** Release or reject a tested batch — someone other than the tester. */
export function QualityDecision({ orderId, testId, passed }: { orderId: string; testId: string; passed: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<FlowState>({ error: null, message: null });
  const [note, setNote] = useState('');
  const decide = (decision: 'RELEASE' | 'REJECT') => start(async () => setState(await decideQualityTest(orderId, testId, decision, note || undefined)));
  return (
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={passed ? 'Note (optional)' : 'Why rejected'} aria-label="Decision note" />
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        {passed ? (
          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => decide('RELEASE')}>
            Release batch
          </button>
        ) : null}
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => decide('REJECT')}>
          Reject batch
        </button>
      </div>
    </div>
  );
}
