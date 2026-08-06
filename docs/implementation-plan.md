# BioAssetPro — Implementation Plan (SnailPro + PoultryPro Pilot)

Prepared after reading: Consolidated Data Model Reference, Addendum (Stages 1–8),
SnailPro & PoultryPro Enhanced Processing workbooks, Nigeria PAYE 2026 workbook,
Nigeria Statutory Payroll workbook.

---

## Part A — Findings that change the build

### A1. Stage 7 (Biological Asset Register / IAS 41) is confirmed absent — hard blocker

The addendum promises it and then never delivers it. Line 2735 of the extracted
addendum reads: *"This completes Stage 6. The next stage should be Stage 7 –
Biological Asset Management (IAS 41)…"* and the document jumps straight to
Stage 8 (Processing). There is no PRD/FRS/SOP/TDD for it anywhere in the set.

**What we DO have** is the exact interface Processing expects from it
(Addendum §2.3 Source Batch Transfer, §3696 Live-Bird Transfer):

| Field | Snail | Poultry |
|---|---|---|
| Harvest/transfer reference | ✓ | ✓ |
| Farm, Zone, Pen / House | ✓ | ✓ |
| Biological batch / flock batch | ✓ | ✓ |
| Harvest date, quantity, total weight, average weight | ✓ | ✓ |
| Quality / ante-mortem status | ✓ | ✓ |
| Processing destination, transfer date, approved by | ✓ | ✓ |
| Posting | Dr Harvested Snail RM Inventory / Cr Biological Assets – Market-ready Snails | Dr RM Inventory – Live Birds / Cr Biological Assets – Market-ready Birds |

So the **contract** is known; the **valuation model behind it is not**. What is
missing and cannot be guessed:

- IAS 41 fair-value-less-costs-to-sell vs. cost model election
- Valuation trigger points (period end? weight band? age? transfer?)
- Cost accumulation rules for breeders/eggs/hatchlings/growers
- Mortality accounting (normal vs. abnormal, at what carrying value)
- Transfer-between-stage revaluation and where the gain/loss lands

**Recommendation:** build Phase 5 as a *Biological Batch Source Interface* — a
thin, spec-backed boundary that provides `HarvestTransfer` / `LiveBirdTransfer`
with the fields above and posts the one entry the addendum specifies, backed by a
`BiologicalBatch` table carrying only identity and dimensions (no valuation
logic). This unblocks Processing without inventing IAS 41. When Stage 7 arrives,
the real module plugs in behind the same interface.

**Ask Samuel Olubowale for:** Stage 7 PRD/FRS/SOP/TDD, the Snailery Accounting
Postings & Workflows document, the Snailery SOPs, the original Developer Handover,
the PDR, and the referenced Python code samples.

---

### A2. The PoultryPro workbook does not implement joint-cost allocation — and its costing is broken

This is the most consequential finding. The addendum (§2.7 and §4.4) requires a
real joint-cost engine with five methods (weight, relative sales value, NRV,
standard percentage, manual). **The workbook does none of this.** It copies the
SnailPro single-product structure verbatim: five independent production orders,
each with a BOM that consumes *whole live birds*.

The BOM says, per finished unit:

| Product | Live birds per unit | Material cost/unit |
|---|---|---|
| Whole Dressed Chicken 1.5kg | 1.0 | ₦6,500 |
| Chicken Breast 1kg | 3.6 | ₦23,400 |
| Drumsticks 1kg | 5.3 | ₦34,450 |
| Wings 1kg | 7.7 | ₦50,050 |
| Gizzard 500g | 10.0 | ₦65,000 |

Each order therefore pays for the *entire bird* to obtain one cut, and the other
cuts vanish. Consequences visible in the workbook's own numbers:

- **Unit costs are nonsense.** Wings: ₦338,775/kg cost against a ₦9,000 selling
  price (Costing_Summary O8 = −36.64, i.e. −3,664% margin). Gizzard:
  ₦1,118,693/unit against ₦4,200 (O9 = −265.36, i.e. −26,536% margin). Four of
  the five products show negative margins.
- **Inventory is over-consumed.** The five orders consume
  400 + 792 + 954 + 1,232 + 1,200 = **4,578 live birds** against an opening stock
  of **2,500** (Masters C5). The same physical bird is charged to multiple orders.
- **Abnormal loss is inflated to match**, because it is derived as
  `abnormal_qty × gross_cost / input_base` — ₦3.63m of "production loss" on a
  ₦30.2m WIP.

The `TB_WIP_Control` sheet still reports CLEARED and TB BALANCED — because WIP
clearing is a *self-consistency* test (FG is computed as the residual plug), not
a test of whether the costing is economically right. **The workbook proves the
identity, not the model.**

**Implication for the build:** the PoultryPro workbook is a valid executable spec
for the *WIP-clearing identity and GL posting shapes only*. It must **not** be
used as the reference for poultry costing. The correct model is one
`ProcessingOrder` per slaughter run, producing many joint outputs, with the
addendum's allocation engine splitting the joint cost. I will build to the
addendum, not the workbook — flagged for confirmation with the consultant.

**Bonus:** SnailPro §2.4 (raw-material separation into meat/slime/shell) specifies
the *same four allocation methods*. So this is one shared `CostAllocation` engine
serving both snail separation and poultry cut-up — not a Poultry-only concern.

---

### A3. "Stage 6" is used twice

- Addendum line 2086: **Stage 6 – Human Resources & Payroll**
- Addendum line 2486: **Stage 6 – Period-End Closing & Year-End Closing**

The Consolidated Reference disambiguates them as §7 and §8 ("Stage 6b").
Build order treats them as separate phases (9 and 11 respectively). Confirm the
intended numbering with the consultant so future correspondence matches.

---

### A4. Money-as-integer rule collides with three places in the source models

The hard rule (integers in kobo) is right, but these need explicit handling:

1. **Quantities are fractional and are not money.** The workbooks carry 0.9 L of
   preservative, 292.8 kg of snails, 446.2 units of good output, 194.83 kg
   finished. Quantity needs `Decimal` with a per-UoM scale defined in the UoM
   master — not integers, not floats.
2. **Unit cost is derived, never stored as the source of truth.** The workbook
   shows ₦577.44554011653975/unit. Store total cost in kobo; derive unit cost for
   reporting at display precision. Never post a unit cost × quantity.
3. **Rounding residuals must have a defined home.** Two cases:
   - *Production completion:* post Finished Goods as the **residual plug** of the
     WIP account (`FG = WIP_debits − byproduct_credit − abnormal_loss_credit`),
     computed in integer kobo. This makes Rule 7's identity hold *by construction
     and exactly*, with no epsilon tolerance — which is stronger than the
     workbook's `ABS(x) < 0.01` check.
   - *Payroll:* monthly PAYE = annual ÷ 12 leaves a residual. Needs a documented
     rule (recommend: accumulate residual and absorb in the final period's
     true-up, which the PAYE workbook's YTD reconciliation already supports).

**Also flagged:** the workbook's `Net FG Cost = MAX(0, Gross − Byproduct −
AbnormalLoss)` floor. If by-product credit plus abnormal loss ever exceeds gross
WIP cost, the floor silently breaks WIP clearing (the control then reports NOT
CLEARED after the fact). The engine should *reject the completion up front* with
a clear error rather than post a floored figure.

---

### A5. Configuration values that appear hard-coded in the workbooks

Every one of these must be effective-dated configuration (Rule 8):

| Value | Where it's hard-coded | Notes |
|---|---|---|
| By-product valuation ₦200/unit | `Costing_Summary!H` — literal `*200` | Must be a valuation policy per by-product item |
| Labour ₦2,500/hr, Var OH ₦1,800/hr, Fixed OH ₦1,200/hr | Assumptions sheet | Already flagged "editable" — make them effective-dated rate tables |
| VAT 7.5% | Assumptions | Tax Engine, effective-dated |
| Abnormal waste threshold 5% | Assumptions | Approval trigger |
| Minimum wage ₦70,000 | Used for **two different purposes** — PAYE exemption AND NHF eligibility floor | Two separate config keys that currently share a value; do not collapse them |
| Pension 8% employee rate | Defined **twice** — PAYE workbook `PAYE_Rules!B8` and Statutory workbook `Statutory_Rules!C5` | Single source of truth; the PAYE engine must read the same rate the Statutory engine deducts |

---

### A6. PAYE / Statutory engine details worth pinning now

Verified against the workbooks; these are the exact rules to implement.

**PAYE (Nigeria Tax Act 2025, effective 1 Jan 2026):**

```
annual_gross        = (basic + housing + transport + other_taxable) * 12 + annual_bonus
pension_deduction   = (basic + housing + transport) * 12 * pension_rate   [if enrolled & active]
rent_relief         = annual_rent > 0 ? MIN(annual_rent * 20%, 500_000) : 0
eligible_deductions = pension + nhf + nhis + life_assurance + mortgage_interest + rent_relief
chargeable_income   = MAX(0, annual_gross - eligible_deductions)
annual_tax          = Σ_bands MAX(0, MIN(chargeable - lower_limit, band_width)) * rate
                      -> 0 if monthly_gross <= minimum_wage OR employee not Active
monthly_paye        = annual_tax / 12          (round only at the payroll line)
ytd_true_up         = MAX(0, annual_tax * months_elapsed/12 - paye_already_deducted_ytd)
```

Bands: 0–800k @0%, next 2.2m @15%, next 9m @18%, next 13m @21%, next 25m @23%,
above 50m @25%. Marginal/band-by-band only — never apply the top rate to the
whole income. **No Consolidated Relief Allowance** (explicitly removed; rent
relief replaces it). Group the payable by employee `tax_state` for remittance.

Note on the true-up: the workbook's sample has `months_worked = 12`, which makes
the "current month true-up" equal the full annual liability. That is a sample
artifact — the engine must use *months elapsed in the tax year*, not months the
employee is contracted to work.

**Statutory:**

```
pension_applicable = company.employee_count >= 3 AND employee.pension_enrolled AND active
pension_base       = basic + housing + transport            (NOT gross)
employee_pension   = employer_pays_all ? 0 : pension_base * 8%
employer_pension   = pension_base * (employer_pays_all ? 18% : 10%)   [combined min 18%]
nhf_eligible       = active AND gross >= minimum_wage
                     AND (sector = Public OR (Private AND company.nhf_enabled AND employee.nhf_enrolled))
nhf                = nhf_eligible ? gross * 2.5% : 0        (base configurable; defaults to gross)
nsitf              = gross * 1%           employer only, never deducted from employee
itf                = (employee_count >= 25 AND NOT free_trade_zone) ? gross * 1% : 0
                     monthly accrual, annual payment
```

GL: reject any payroll posting where cost centre is missing. Idempotency key
required. Store the full calculation snapshot with `rule_version`; a posted
calculation is immutable and recalculation creates a new version.

---

## Part B — Architecture decisions

### B0. DECIDED (confirmed by Timi)

| Decision | Choice |
|---|---|
| Enterprise Dimensions modelling | **Embedded FK columns** — shared Prisma fragment, mandatory six enforced `NOT NULL` at DB level, conditional ones via config-driven `DimensionValidator` |
| Stage 7 / IAS 41 gap | **Build the source interface only** — `BiologicalBatch` (identity + dimensions), `HarvestTransfer`, `LiveBirdTransfer`, the two specified postings. No valuation, costing, or mortality logic until Stage 7 documentation arrives |
| Repo location | **`C:\Users\Toyosi\Downloads\bioassetpro`** — new sibling directory, fresh Turborepo, own git repository |

### B1. Enterprise Dimensions modelling — options considered

**Option 1 — Embedded FK columns on every postable table**

```prisma
// A Prisma "type"-style block composed into each postable model
companyId, branchId, financialYearId, financialPeriodId, currencyId, exchangeRate   // mandatory
departmentId?, costCentreId?, farmId?, penHouseId?, batchId?, projectId?            // conditional
```

- **Pros:** fast queries and aggregations (plain indexed columns, no joins);
  DB-level `NOT NULL` enforces the mandatory six; trivial to reason about in the
  trial balance; Prisma types are ergonomic.
- **Cons:** ~12 columns repeated across ~40 tables; adding a dimension later is a
  wide migration; "conditional mandatory" (cost centre mandatory *by account*,
  batch mandatory *where applicable*) still needs service-layer validation.

**Option 2 — Normalized `DimensionSet` + `DimensionValue` link table**

```prisma
model DimensionSet   { id, hash, values DimensionValue[] }
model DimensionValue { setId, dimensionTypeId, valueId }
// postable tables carry a single dimensionSetId
```

- **Pros:** one column per table; new dimensions are pure configuration; natural
  fit for the "configurable by transaction type" requirement; dimension sets can
  be deduplicated by hash.
- **Cons:** every report needs pivot/join gymnastics; loses DB-level NOT NULL on
  the mandatory six (all validation moves to the service layer); noticeably
  slower for the trial balance and dimensional P&L that this system exists to
  produce; harder to debug.

**My recommendation: Option 1, with a twist.** Define the dimension block once as
a shared Prisma fragment and a single `EnterpriseDimensions` value object in
NestJS; enforce the mandatory six at the DB level and the conditional ones in a
shared `DimensionValidator` driven by config (per account, per transaction type).
This system's whole value proposition is dimensional financial reporting — pay
the schema-width cost to keep those queries flat and the invariants
database-enforced. Option 2's flexibility is a benefit we'd rarely spend and a
cost we'd pay on every report.

### B2. Confirmed stack (no substitutions proposed)

Turborepo · NestJS · PostgreSQL · Prisma · Next.js App Router · JWT + RBAC ·
`decimal.js` for fractional math · Vitest/Jest for tests.

Two additions I'd propose (flagging rather than swapping):
- **BullMQ + Redis** for escalation timers and notification fan-out (§2 requires
  24h/48h/72h escalation — this needs a durable scheduler, not a cron in-process).
- **A dedicated PDF library** for payslips — decide at Phase 9, not now.

### B3. Cross-cutting invariants enforced as shared infrastructure

| Invariant | Where enforced |
|---|---|
| Money is integer kobo | Prisma `BigInt` + a branded `Kobo` TS type; lint rule banning `number` on amount fields |
| Posted rows immutable | Prisma middleware rejecting `update`/`delete` on posted GL/journal/production rows, **plus** a Postgres `BEFORE UPDATE OR DELETE` trigger so it holds even outside the ORM |
| Maker ≠ checker | `WorkflowService.approve()` — service layer, not UI |
| Full dimension set present | `DimensionValidator` called by the single `PostingService` |
| Idempotency | Unique index on `(endpoint, idempotency_key)`; replay returns the original result |
| Debits = credits | `PostingService` refuses to commit an unbalanced journal — every posting path goes through it |
| Audit record written | Same DB transaction as the posting; append-only table, revoked UPDATE/DELETE grants |

**One posting service. Every module calls it. No exceptions.**

---

## Part C — Phase plan

Each phase ships with: Prisma schema diff · endpoint list · passing tests ·
written record of assumptions made. Sign-off before the next phase starts.

| # | Phase | Key deliverables | Proves |
|---|---|---|---|
| 1 | **Core platform** | Company, Branch, Cost Centre (hierarchical), Chart of Accounts, Financial Year/Period, Currency + Exchange Rate, EnterpriseDimensions engine, `PostingService`, `AuditService`, immutability triggers | Balanced posting; dimension validation; audit written; posted rows unmodifiable |
| 2 | **Workflow & Approval Engine** | 10 workflow tables, status machine, N-level approval, routing by type/branch/farm/dept/cost-centre/currency/amount/role, approval limits, delegation, escalation (BullMQ), notifications, immutable history | Maker cannot approve own txn (service layer); escalation fires; every event audited; a module can register a new transaction type with zero engine changes |
| 3 | **Tax Engine** | TaxCode/VATCode/WHTCode, registers, TaxPeriod, TaxConfiguration, TaxGLMapping, effective-dated rates | VAT/WHT computed once, shared; 7.5% is config not constant |
| 4 | **Master data** | Supplier, Customer, Item/Product, UoM (with scale), Warehouse, Employee, BOM/Recipe with **versioning + effective dating** | Recipes are data; a new species needs no schema change |
| 5 | **⚠ Biological Batch Source Interface** | `BiologicalBatch` (identity + dimensions only), `HarvestTransfer`, `LiveBirdTransfer`, the two specified postings, traceability link | Processing can source batches. **No IAS 41 valuation logic — awaiting Stage 7** |
| 6 | **Processing engine** | Generic engine (§9) → SnailPro (§10) → **CostAllocation engine** (5 methods) → PoultryPro (§11) as one order → many joint outputs | **Rule 7 WIP identity, exactly, in integer kobo.** Material issue blocked unless order Approved/Released/In-Production/Completed. Completion gate: all 9 checks. Allocation percentages total 100% |
| 7 | **Procure-to-Pay** | PR → RFQ → PO → GRN → Invoice → 3-way match → Payment | GRNI clears; 3-way match exceptions route to workflow |
| 8 | **Order-to-Cash** | Quote → SO → Credit check → Delivery → Invoice → Receipt → Statement | Credit check blocks and routes; COGS posts with delivery |
| 9 | **HR & Payroll** | Employee lifecycle, leave, appraisal, payroll run, **PAYE engine**, **Statutory engine**, payslips, bank schedule | Every workbook sample row reproduced to the kobo; PAYE grouped by tax state; no CRA |
| 10 | **Manual Journal / Adjustment Centre** | Journal types, reason codes, recurring, reversals, customer/supplier adjustments. *Can run parallel with 7–9* | Delete is impossible; reversal is the only correction path |
| 11 | **Period-End & Year-End Close** | Financial calendar, Open/Soft-Close/Closed/Archived, checklists, close/reopen workflow, year-end wizard, roll-forward | Soft close blocks non-Finance postings; year-end runs as one transaction that fully rolls back on any validation failure |

### Test strategy — the two identities are regression tests, not documentation

```ts
// Phase 1 onward, run after EVERY posting in the suite:
expect(sum(glLines.debit)).toBe(sum(glLines.credit))        // exact, integer kobo

// Phase 6, per completed production order:
expect(wipDebits).toBe(fgCredit + byProductCredit + abnormalLossCredit)  // exact
expect(closingWip(orderId)).toBe(0n)                                     // exact
```

Both assert exact integer equality — no `< 0.01` tolerance. The workbooks' epsilon
checks exist because Excel uses floats; we don't have to inherit that.

Phase 6 additionally replays all five SnailPro workbook orders as fixtures and
asserts the resulting GL matches `TB_WIP_Control` line for line.

---

## Part D — Open questions

**Blocking (need answers before the phase they gate):**

1. **Stage 7 / IAS 41** — Phase 5–6 gate. Fair value vs cost model? Valuation
   triggers? Mortality treatment? Is the documentation coming?
2. **PoultryPro joint costing** — Phase 6 gate. Confirm the workbook's
   one-order-per-cut model is wrong and the addendum's joint-cost engine is
   authoritative. Which allocation method is the default?
3. **By-product valuation policy** — Phase 6. The ₦200/unit is hard-coded.
   NRV? Standard cost? Zero-value with proceeds to other income?

**Non-blocking, need confirmation:**

4. Approval-limit defaults (₦250k / ₦2m / ₦10m) — real or illustrative?
5. Pension rate: single source of truth confirmed for both PAYE relief and
   statutory deduction?
6. NHF calculation base — gross (workbook default) or pensionable emoluments?
7. PAYE rounding residual — absorb in final period's true-up?
8. "Stage 6" numbering collision — which is which in future correspondence?
9. Benefit-in-kind (housing/vehicle) valuation rules — flagged in the PAYE
   workbook as "may require separate configurable rules", not specified.

---

## Part E — What I will not do

Per Part 5 of the brief and Rule 10:

- No FishPro/PigPro/CattlePro — but schema and engines stay species-agnostic.
- No MRP, capacity planning, shop-floor control, or machine maintenance.
- No Mobile Money.
- No Consolidated Relief Allowance.
- **No invented biological-asset accounting.** Phase 5 is an interface, not a model.
- No guessed tax rates, statutory rates, or approval limits — every one is
  configuration seeded from the workbooks with its source URL and effective date
  recorded.
