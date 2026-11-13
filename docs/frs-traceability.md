# FRS traceability — handbook §11 against the application

Every functional requirement in the Beginner Developer Handbook (v8.9.8,
§11 *FRS — functional requirements*) against the code that implements it and
the test that proves it.

Measured on commit `6839448`, 2026-10-31. The whole suite was run for this
table, not sampled:

| Suite | Files | Tests | Result |
|---|---|---|---|
| Unit | 19 | 118 | all passed |
| Integration | 61 | 620 | all passed |

Test names below are `describe` blocks in `apps/api/test/integration/`. Run
them with `npm run test:integration --workspace @bioassetpro/api`.

**Read the two exceptions at the bottom before using this table.** Every row
is evidenced, but two requirements are satisfied by the code and not by the
running deployment, which a traceability table will otherwise hide.

## §11 FRS

| ID | Requirement (abridged) | Evidence |
|---|---|---|
| FR-MD-01 | Effective-dated COA, cost centres, farms, warehouses, species, units, tax and posting profiles; invalid or expired combinations blocked | `Master Data (§5, §6, §7, §10)`; `supplier & customer masters (§5, §6)`; `Approved species and breeds (SNAIL_SPECIES_MASTER, POULTRY_BREED_MASTER)`; `Provisioning a new farm on the approved five-digit chart`; `PostingService — Enterprise Dimensions (§1.1)` |
| FR-WF-01 | Route exceptions to configured approvers; no self-approval where SoD applies | `the approval ladder in motion`; `the document only reaches the ledger through approval`; `Role access (UAT-001)` |
| FR-PROC-01 | PR → PO → GRN → invoice → payment with 3-way match; chain and exceptions visible | `Procure-to-Pay (§5)`; `three-way match (§5)`; `supplier invoice (§5)`; `supplier payment (§5)`; `THE IDENTITY: GRNI clears to zero` |
| FR-INV-01 | Perpetual quantity and value by item, lot and location; no negative stock | `Inventory control (UAT-006)`; `Stock counts (INT-009)`; `Lots, expiry and quarantine (FR-FM-02)`; `the inward stock flow` |
| FR-INV-02 | WAC recalculated on each eligible receipt; pre-issue WAC applied to issues | `Inventory control (UAT-006)`; `Feed issued from stock`; `RearingCostService — relief at weighted average` |
| FR-LIFE-01 | Breeder cohort and unique egg/incubation/hatch batches; genealogy retained | `SnailBreedingService`; `Lot traceability (AC-011)`; `Placement (UAT-010 / UAT-016)` |
| FR-LIFE-02 | Laying recorded without reducing breeder quantity | `Eggs at a dated value per crate (PCR-067/068/069)`; `SnailBreedingService` |
| FR-LIFE-03 | Egg set = hatch + unhatched + approved loss; hatch cannot approve otherwise | `SnailBreedingService`; `Incubation log and incubator capacity (FR-LIFE-04, INT-025)` |
| FR-LIFE-04 | Incubation readings captured; missing or out-of-range values alert | `Incubation log and incubator capacity (FR-LIFE-04, INT-025)` — cites the requirement by name |
| FR-BA-01 | Stage transfer, normal and abnormal mortality, valuation evidence; rollforward ties | `Deaths and abnormal loss (UAT-013 / UAT-017)`; `Stage by age (UAT-012)`; `Age and stage`; `valuation and mortality results on the approved chart` |
| FR-BA-02 | Policy-controlled FVLCTS recognition and remeasurement; override needs reason and approval | `valuation and mortality results on the approved chart`; `CashFlowService — biological assets` |
| FR-SALES-01 | Quotation, order, credit, dispatch, invoice, receipt, return; journals traceable | `Order-to-Cash (§6)`; `Order-to-cash on the approved chart` |
| FR-MFG-01 | BOM, routing, version and production order linked to source batch; only released versions post | `Standard costing (POL-001–004, SOP-049/050, PCR-032–036)`; `Processing and production-order close (UAT-015 / UAT-024)` |
| FR-MFG-02 | WIP accumulation and FG/by-product/loss; input-output reconciliation enforced | `Poultry processing and close (UAT-020)`; `Snail processing on the approved chart`; `Processing and production-order close (UAT-015 / UAT-024)` |
| FR-MFG-03 | Standard and actual variances; WIP and recovery cleared at close | `Standard costing (POL-001–004, …)`; `Feed mill on the approved chart`; `Machine depreciation split by machine hours (PCR-031)` |
| FR-HR-01 | Employee, contract, bank, tax and pension IDs, effective dates; sensitive access logged | `HR & Payroll (§7, §7.1, §7.2)`; `Sensitive employee numbers` — **see exception 1** |
| FR-HR-02 | Time approval, payroll calculation, labour allocation, liabilities posted and paid | `HR & Payroll (§7, §7.1, §7.2)`; `PAYE engine reproduces the Nigeria_PAYE_2026 workbook`; `the register agrees with the ledger`; `Farm labour and overhead by animal-days (PCR-028/043/064)` |
| FR-GL-01 | Balanced, idempotent, dimensional journals from approved events; drill-through and reversal link | `PostingService — the balance invariant`; `— idempotency (Rule 6)`; `— Enterprise Dimensions (§1.1)`; `— reversal is the only correction path`; `the journal register (§3)` |
| FR-GL-02 | No posting to locked periods; controlled reopen workflow; reopen activity audited | `PostingService — period status gate (§8)`; `Period-End & Year-End Closing (§8)`; `the close checklist (§8)` — **see exception 2** |
| FR-GL-03 | Monthly and year-end close; balance-sheet accounts carried forward only; post-close TB passes | `THE IDENTITY: year end sweeps revenue and carries the balance sheet`; `year-end close on the approved chart` |
| FR-RPT-01 | P&L, BS, CF, TB, GL, ageing, BA, WIP, inventory, payroll and KPI reports | `Financial statements (UAT-022)`; `CashFlowService — direct method (AC-ENT-001, 500_Cash_Flow)`; `supplier ageing agrees with the payables control account`; `KPIs: current ratio and inventory days (KPI-02, KPI-04)`; `SegmentProfitLossService`; `Report access (UAT-023)` |
| FR-AUD-01 | Immutable create/change/approve/post/reverse logs with before and after values | `AuditService — Rule 9`; `PostingService — immutability (Rule 2)`; `§3: delete is disabled entirely`; `Record retention` |

## The two exceptions

A green test means the code satisfies the requirement. It does not always mean
the deployment does, and the difference is invisible in the table above.

### 1. FR-HR-01 — employee data is currently stored in plaintext

The requirement covers bank, tax and pension identifiers. Two halves:

- **Access logging: satisfied.** `reveal()` writes an `AuditAction.VIEW` row
  before returning any number in the clear
  (`apps/api/src/masters/employee-onboarding.service.ts`).
- **Storage encryption: not implemented.** By current design, employee bank,
  tax, pension and identity values and identity-check references are stored as
  plaintext. Masking and reveal auditing apply in the application only; anyone
  with direct database or backup access can read these values.

This is a known, user-accepted temporary risk, not a satisfied encryption
requirement. Encrypt backups and restrict database and backup access until
field-level encryption is restored.

### 2. FR-GL-02 — reopen was blocked in the live farm until 2026-10-30

The code satisfies this and always did. The live data did not: `PERIOD_REOPEN`
was listed twice in the routes every farm is provisioned with, from 2026-09-27
(`fe7d509`), so each farm carried two identical company-wide approval ladders.
Routing refuses a tie rather than guess between equally specific definitions,
so period reopen was refused outright — in every farm provisioned in that
month, including the live one.

The list was corrected in #29 and the rows removed from existing farms by
migration `0053` in #31, live since 2026-10-31. **Confirm it in the
application before relying on this row**: close a period and reopen it. A
passing test could not have caught this, because the fault was in provisioned
data rather than in code.

## Scope

This table covers handbook §11 only. The codebase also cites `FR-FM-02`,
`FR-FM-03` and `FR-PRO-02`, which come from the module sections (§26 feed mill,
§28–29 processing) and §30 *FRS, technical rules and UAT additions*. Those are
not traced here.

The Developer Master workbook has 165 sheets. The sweep of its control sheets —
`Acceptance_v2`, `Acceptance_Criteria`, `Costing_Policy_v2`,
`STANDARD_COST_CHECKS`, `SYSTEM_INTEGRITY_MATRIX` — is in
[control-gap-register.md](control-gap-register.md). Its v8.9.8 biological
master-data sheets are evidenced by `glossary.spec.ts`, which tests the in-app
glossary against `FARMING_GLOSSARY` and `BIO_TERMINOLOGY_SCREEN_MAP` and
requires every one of the 26 terms to name a screen that exists, and by
`110_biological_event_constraints.sql`, which enforces `BIO_MASTER_CHECKS`
(weight history immutable; population never negative).

**Responsible Supervisor** is now stored on each livestock group. New
placements require an active, species-eligible supervisor from the same
company; reassignment is audited. Migration `0064` must be deployed and
existing groups assigned before the control is operational on a given
database.
