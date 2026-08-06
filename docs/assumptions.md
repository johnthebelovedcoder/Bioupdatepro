# Assumptions and open questions

Rule 10: where the source documents are silent, we flag rather than guess.
Every entry here is a decision that needs the client's or consultant's
confirmation. None of them has been resolved by picking whichever
interpretation was easiest to build.

---

## Phase 1 — Core platform

### A1. Exchange rate is captured but never revalued
**Source position:** §1.1 makes Currency and Exchange Rate mandatory on every
transaction. No source document specifies a rate source, a revaluation policy,
or where a revaluation gain/loss would post.
**What we built:** the caller supplies the rate; it is stored on the journal and
its lines and is never recalculated after posting. `ExchangeRate` exists as an
effective-dated master so a default can be resolved, but nothing consumes it
automatically yet.
**Needs confirmation:** is the pilot single-currency (NGN only)? If not, we need
the revaluation policy before Phase 7 (P2P) introduces foreign-currency
suppliers.

### A2. Chart of accounts is seeded only from what the workbooks actually name
**What we built:** 18 accounts, each traceable to a specific workbook cell —
recorded in the `source` field of every seed entry in
`packages/database/src/seed.ts`.
**What we did NOT do:** invent account numbers to fill obvious gaps (there is no
Trade Receivable, Trade Payable, Input/Output VAT, GRNI or Scrap account yet,
because no source document names them).
**Needs confirmation:** the client's real chart of accounts. Phases 3, 7 and 8
each need accounts that do not exist yet.

### A3. `requiresCostCentre` is set on two accounts only
**Source position:** §1.1 says Cost Centre is "configurable, mandatory by
account". SnailPro TDD §10.5 says "Require cost centre on every production GL
line."
**What we built:** the flag is per-account configuration. It is seeded `true`
for 1501 Work in Progress and 5305 Production Loss Expense, and `false`
everywhere else.
**Needs confirmation:** which accounts the client wants it mandatory on. This is
a configuration decision, not a code change.

### A4. Roles permitted to post into a soft-closed period
**Source position:** §8 names "Finance Manager / Financial Controller /
Administrator".
**What we built:** exactly those three role codes, in
`SOFT_CLOSE_POSTING_ROLES`.
**Needs confirmation:** the client's actual role taxonomy. Phase 11 moves this
into the period-close configuration table.

### A5. Period status is settable directly in Phase 1
**What we built:** `POST /api/core/periods/:id/status` sets the status with no
workflow and no close checklist.
**Why:** the posting gate needs to be testable now, and the real close process
depends on the Workflow Engine (Phase 2) and every module being able to post
(Phase 11).
**Not a decision needing confirmation** — a deliberate, temporary scaffold that
Phase 11 replaces. Flagged here so it is not mistaken for the finished feature.

### A6. Journal numbering is caller-supplied
**Source position:** the documents show journal number formats
(`JRN-SN-0001`, `PAYE-ACCR-001`, `PAY-2026-07`) but never specify a generator,
a reset cadence, or whether numbering is per-company, per-module or per-period.
**What we built:** the caller supplies `journalNumber`; uniqueness is enforced
per company.
**Needs confirmation:** the numbering scheme, before any module starts
generating numbers automatically.

---

## Carried forward from the implementation plan

These are unresolved and gate later phases. Full detail in
`docs/implementation-plan.md`.

| # | Question | Gates |
|---|---|---|
| 1 | **Stage 7 / IAS 41** — fair value vs cost model, valuation triggers, mortality treatment. Documentation confirmed missing from the source set. | Phase 5, 6 |
| 2 | **PoultryPro joint costing** — the workbook models one order per cut, consuming whole birds; this over-consumes stock by 83% and produces −3,664% margins. Confirm the addendum's joint-cost engine is authoritative. | Phase 6 |
| 3 | **By-product valuation policy** — the workbook hard-codes ₦200/unit. NRV? Standard cost? Zero-value? | Phase 6 |
| 4 | **Approval-limit defaults** — are ₦250k / ₦2m / ₦10m real or illustrative? | Phase 2 |
| 5 | **Pension rate source of truth** — defined independently in both payroll workbooks. | Phase 9 |
| 6 | **NHF calculation base** — gross (workbook default) or pensionable emoluments? | Phase 9 |
| 7 | **PAYE rounding residual** — absorb in the final period's true-up? | Phase 9 |
| 8 | **"Stage 6" collision** — used for both HR/Payroll and Period-End Closing. | Documentation |
| 9 | **Benefit-in-kind valuation** — flagged in the PAYE workbook as needing separate configurable rules; not specified. | Phase 9 |
