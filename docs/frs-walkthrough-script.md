# FRS walkthrough — running the session

A script for walking the client through BioAssetPro against handbook §11, the
22-row FRS. Every screen named here exists and is named as the sidebar names
it. The evidence for each block is in
[frs-traceability.md](frs-traceability.md); this is how to show it live.

Budget about 90 minutes for the eight blocks, plus 15 minutes of preparation
on your own beforehand and 10 at the end for what you need back from them.

Sign in as the CFO or Administrator role. Anything narrower cannot reach the
ledger screens and the session stalls on a permission page.

---

## Before they join — 15 minutes, alone

Four checks. Each has bitten this project already, and all four are quiet
failures: nothing on screen says they are wrong until you are in front of
somebody.

| # | Check | How | If it fails |
|---|---|---|---|
| 1 | **The API is awake** | Open `/api/health`. It should answer at once and report the current commit. | A cold start takes 53–56 seconds. Open it ten minutes before the call, not at the start. |
| 2 | **Period close is ready** | **Period close** → open the checklist for an older period. Verify you can see the 14 items and that settlement and close are not blocked by a routing error. | If it refuses with a workflow-routing error naming two matching definitions, migration `0053` has not reached that database. Stop and say so; do not demonstrate FR-GL-02. **Do not attempt a full close — it requires settling all 14 checklist items, raising FVLCTS valuations for every population, and approving them through a four-level ladder. That is real month-end, not a demo step.** |
| 3 | **Employee numbers are encrypted** | Verify `PII_ENCRYPTION_KEY` is configured in the deployment and the API starts successfully; then open an employee and reveal the bank account. | Do not demonstrate or enter employee data if the key is missing or the API cannot decrypt existing values. The API now fails closed; deployment configuration and restored-data access still need verification. |
| 4 | **Privileged MFA works** | Sign in fresh as a privileged user; verify the authenticator challenge and recovery process. | Required roles cannot enter the application on a password-only session. Stop the demo if the deployed challenge, key configuration, or recovery flow is not verified. |

Have `frs-traceability.md` open in a second window. When someone asks "how do
you know", the answer is a named test, not an opinion.

---

## Block 1 — Masters and the control frame (10 min)

*Covers FR-MD-01, FR-WF-01, FR-AUD-01.*

| Open | Show | The requirement it answers |
|---|---|---|
| **GL accounts** (`/admin/accounts`) | The approved five-digit chart, live. A new farm is provisioned onto it. | FR-MD-01 — effective-dated COA |
| **Cost centres** (`/admin/cost-centres`) | The hierarchy, and that a cost is charged to the business that incurred it | FR-MD-01 |
| **Approval rules** (`/admin/approvals`) | The ladder: who approves what, at which amount | FR-WF-01 |
| **Audit trail** (`/ledger/audit`) | Create, change, approve, post, reverse — with before and after | FR-AUD-01 |

**The point to land:** nothing reaches the ledger except through an approval,
and nothing that reached it can be edited afterwards. Say the acceptance rule
in their own words — *"no self-approval where SoD applies"* — and show it.

---

## Block 2 — Procure to pay (12 min)

*Covers FR-PROC-01, FR-INV-01, FR-INV-02.*

Walk one purchase end to end rather than showing five screens statically:

1. **Requisitions** (`/procurement/requisitions`) — raise one
2. **Purchase orders** (`/procurement`) — approve it into an order
3. **Goods received** (`/procurement/receipts`) — open the expected delivery
   and record it. (The receive form's own route carries the order id, so
   reach it from here rather than typing a path — `/procurement/receive`
   on its own is a 404.)
4. **Invoices** (`/procurement/invoices`) — three-way match
5. **Lots and expiry** (`/inventory/lots`) — where the stock landed

**The point to land:** the chain is visible from any end, and GRNI clears to
zero. That last identity is the one finance people check first, and it has its
own test.

Mention weighted average here (FR-INV-02): cost is recalculated on receipt and
frozen at issue. **Trace a lot** (`/inventory/trace`) is the dramatic version
if they want it — a sale traced back through processing and harvest to the
goods receipt and supplier of every input.

---

## Block 3 — Lifecycle (15 min)

*Covers FR-LIFE-01 to FR-LIFE-04, FR-BA-01, FR-BA-02. This is the heart of it
for a farm audience — give it the time.*

| Open | Show |
|---|---|
| **Live birds** / **Live snails** (`/m/poultry/population`, `/m/snail/population`) | A cohort: opening, what came in, deaths, sales, what is alive |
| **Incubation log** (`/farm/incubation`) | Set, candling, hatch — and that a set must name an incubator with room |
| **Mortality and cull** (`/farm/mortality`) | Cause, evidence, normal against abnormal |
| **Populations** (`/agripro/biological-assets`) | Carrying value, stage transfers, the roll-forward |
| **Valuations** (`/agripro/valuations`) | FVLCTS raised per population |

**Three things to say out loud, because they are the acceptance rules:**

- Laying does not reduce the breeder flock — no derecognition journal from
  laying alone (FR-LIFE-02)
- Eggs set must equal hatched plus unhatched plus approved loss, and the hatch
  cannot be approved until it does (FR-LIFE-03)
- A population can never go below nothing — enforced in the database, not only
  in the screen (FR-BA-01)

**If they ask about the suggested stage:** the system calculates a stage from
age and breed thresholds and flags a mismatch for review. It does **not** move
animals on its own. That is deliberate and matches the specification.

---

## Block 4 — Feed mill and processing (12 min)

*Covers FR-MFG-01 to FR-MFG-03.*

| Open | Show |
|---|---|
| **Recipes** (`/production/recipes`) | BOM and routing, versioned; only a released version can post |
| **Standard costs** (`/production/standard-costs`) | The six parts: material, packaging, labour, machine, overhead, depreciation |
| **Processing orders** (`/production`) | WIP accumulating; outputs, by-products and loss |
| **Joint-cost prices** (`/production/joint-cost`) | The approved driver splitting a carcass into its products |
| **Yield and profitability** (`/production/results`) | What the order actually returned |

**The point to land:** an order cannot close with an unexplained balance. WIP
and recovery clear, or the close refuses. Say it as the acceptance rule states
it.

---

## Block 5 — Sales (6 min)

*Covers FR-SALES-01.*

**Record a sale** (`/sales/new`) → **Deliveries** → **Invoices** →
**Sales margin** (`/sales/margin`).

Short block. The point is that revenue, tax, receivable and the stock or
biological movement all come from the one approved event, and each is
traceable back to it.

---

## Block 6 — People and payroll (10 min)

*Covers FR-HR-01, FR-HR-02. **Read the caution below before this block.***

| Open | Show |
|---|---|
| **Employees** (`/staff/employees`) | Contract, bank, tax and pension IDs, effective-dated |
| **Timesheets** (`/finance/timesheets`) | Hours approved, and refused when they overlap or land on a closed order |
| **Hours and pay** (`/finance/payroll/hours`) | Labour allocated to the batches that consumed it |
| **Payroll runs** (`/finance/payroll/runs`) | PAYE, pension, NHF to the 2026 statutory rules |

**The point to land:** the payroll register equals the journal equals the
payment. Three numbers, one figure.

> **FR-HR-01 deployment check.** Access to a bank or tax number is logged
> (`reveal()` writes an audit row, visible on **Audit trail**). The application
> now refuses writes and stops production startup if `PII_ENCRYPTION_KEY` is
> missing or too short. Verify the key and existing-data sealing in the target
> deployment before showing employee data; local test evidence is not
> deployment evidence.

---

## Block 7 — Ledger and close (12 min)

*Covers FR-GL-01 to FR-GL-03.*

| Open | Show |
|---|---|
| **Journal entries** (`/ledger/journals`) | A posted journal: balanced, dimensioned, drilling back to its source |
| **Journals** (`/finance/journals`) | That a correction is a reversal, never an edit |
| **Period close** (`/ledger/period-close`) | The checklist and what the close demands (see below) |
| **Year-end close** (`/ledger/year-end`) | Revenue swept, balance sheet carried forward |

> **Period close is real month-end, not a demo step.** Closing a period
> requires settling every item on its 14-point checklist (mark each
> COMPLETE or WAIVED), raising an FVLCTS valuation for every live
> population, approving each valuation through the four-level approval
> ladder (Farm Manager → Finance Manager → Controller → CFO), and only
> then does the close button succeed. Reopening a closed period also
> routes through the approval ladder. This is by design — it enforces
> the discipline the acceptance rules demand — but it is **not** a
> two-minute demo.

**What to show instead of a live close:**

1. Open **Period close** and show the checklist for an older period — the 14
   items, the settlement controls, and the "Close" button that refuses until
   everything is settled and every valuation approved.
2. Show that posting into an already-closed period is refused (pick a period
   the seed data already closed, or show the API's `PostingService` period
   gate in the code).
3. Explain the reopen path: *"Reopening routes through the same approval
   ladder, and every reopen is logged in the audit trail — that is the
   FR-GL-02 acceptance rule."*
4. If they ask to see a live close, offer to walk through it in a follow-up
   working session — it is a 30–45 minute process with real data, which is
   exactly the point.

Finish on **Audit trail** — *"all reopen activity audited"* is the
acceptance rule, and showing that an audit row exists for every period
state change lands better than trying to race through the workflow.

---

## Block 8 — Reports (10 min)

*Covers FR-RPT-01.*

**Trial balance** → **Profit & loss** → **Balance sheet** → **Cash flow**,
then **AR ageing** / **AP ageing**, then **KPIs**.

Two things worth showing rather than listing:

- **Cash flow** carries both the direct and indirect method side by side, and
  they agree with the balance sheet's cash. That was a specific correction
  requested in v8.9.4 and v8.9.5, so they will recognise it.
- **Trial balance** drills into an account and then into the journal behind
  the figure. Drill-through is in the acceptance rule; clicking it is more
  convincing than saying it.

**Controls** (`/ledger/controls`) is the closing screen: every control account
against its subledger.

---

## The three things to say without being asked

Volunteering these costs less than being caught by them, and it is the
difference between a review and a sales pitch.

1. **Privileged MFA is enforced in code.** Required roles must verify an
   authenticator factor; verify the deployed encryption key and complete
   sign-in, setup, recovery, and re-login checks before the pilot.
2. **Employee data encryption fails closed.** Production startup requires
   `PII_ENCRYPTION_KEY`; verify the deployment and a restore procedure that
   keeps the key available outside the database.
3. **Responsible Supervisor is implemented.** New batches require an active,
   species-eligible supervisor from the same company. Apply migration `0064`
   and assign existing batches before relying on the control.

---

## What to ask them for

| Ask | Why it is blocking |
|---|---|
| The **approved account crosswalk**, signed | The balance cutover refuses without a named approver |
| Answers to the **five open questions** in `finance-confirmation-sheet.pdf` | Impairment account, capitalised-variance accounts, stage-maturity lists, approval thresholds, abnormal-mortality rate |
| **Stage 7 (IAS 41) specification**, if it now exists | The addendum promises it and jumps to Stage 8; we built a thin interface rather than inventing a valuation model |
| **MFA deployment evidence** | Verify the required authenticator challenge, recovery, key configuration, and privileged-role access before the pilot |
| Their **UAT sign-off plan** | Gate 5 needs named operators, training and an acceptance signature |

---

## If something fails live

Say what happened, write it down, move on. Do not debug in front of them —
it burns the room's attention and rarely succeeds.

The two most likely failures are both environmental rather than defects: a
cold start that makes a screen hang for a minute, and the period reopen if
migration `0053` has not reached the database you are demonstrating. Check 1
and check 2 exist to stop both.
