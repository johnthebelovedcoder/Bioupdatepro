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
| 2 | **Period reopen works** | **Period close** → close a period, then reopen it. | If it refuses with a workflow-routing error naming two matching definitions, migration `0053` has not reached that database. Stop and say so; do not demonstrate FR-GL-02. |
| 3 | **Employee numbers are encrypted** | **Employees** → open one → reveal the bank account. | If `PII_ENCRYPTION_KEY` is still unset the number shows in clear from storage. You can still demo the control (access is logged), but say plainly it is not yet encrypted at rest. |
| 4 | **Know what MFA will do** | Sign in once, fresh. | Enforcement is off, so a CFO sign-in asks for a password only. If they ask, answer straight: built, switched off on 20 October pending a test of the recovery flow. |

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

> **Caution — FR-HR-01 is half-met in production.** Access to a bank or tax
> number is logged (`reveal()` writes an audit row, and you can show it on
> **Audit trail**). Storage is not encrypted, because `PII_ENCRYPTION_KEY`
> has never been set on the server. If you have set it before the meeting,
> this block is clean. If not, say so when you open the employee record
> rather than letting them find it. It is a settings change, not a defect.

---

## Block 7 — Ledger and close (12 min)

*Covers FR-GL-01 to FR-GL-03.*

| Open | Show |
|---|---|
| **Journal entries** (`/ledger/journals`) | A posted journal: balanced, dimensioned, drilling back to its source |
| **Journals** (`/finance/journals`) | That a correction is a reversal, never an edit |
| **Period close** (`/ledger/period-close`) | The checklist; posting into a closed period refused |
| **Year-end close** (`/ledger/year-end`) | Revenue swept, balance sheet carried forward |

**The reopen demonstration (FR-GL-02)** is the one to rehearse beforehand —
check 2 in the preparation table. Close a period, show the refusal, then
reopen it through the approval workflow and show the reopen in the audit
trail. *"All reopen activity audited"* is the acceptance rule, so finish on
**Audit trail**, not on the close screen.

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

1. **MFA enforcement is off.** Built and tested, switched off on 20 October
   pending a walkthrough of setup, verification and recovery. Every privileged
   role currently signs in with a password alone.
2. **`PII_ENCRYPTION_KEY` is not set**, so staff bank and statutory numbers
   are stored as typed. One settings change; encrypts existing records on the
   next restart.
3. **Responsible Supervisor is not implemented.** `BIO_TERMINOLOGY_SCREEN_MAP`
   asks for a named accountable owner on each cohort. The system records who
   entered and who approved every event, but not a standing owner for the
   batch. The glossary in the app already says so.

---

## What to ask them for

| Ask | Why it is blocking |
|---|---|
| The **approved account crosswalk**, signed | The balance cutover refuses without a named approver |
| Answers to the **five open questions** in `finance-confirmation-sheet.pdf` | Impairment account, capitalised-variance accounts, stage-maturity lists, approval thresholds, abnormal-mortality rate |
| **Stage 7 (IAS 41) specification**, if it now exists | The addendum promises it and jumps to Stage 8; we built a thin interface rather than inventing a valuation model |
| A decision on **MFA** | Whether to enforce before the pilot or accept the risk in writing |
| Their **UAT sign-off plan** | Gate 5 needs named operators, training and an acceptance signature |

---

## If something fails live

Say what happened, write it down, move on. Do not debug in front of them —
it burns the room's attention and rarely succeeds.

The two most likely failures are both environmental rather than defects: a
cold start that makes a screen hang for a minute, and the period reopen if
migration `0053` has not reached the database you are demonstrating. Check 1
and check 2 exist to stop both.
