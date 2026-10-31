# Feature guide — every FRS requirement, and how to do it

What the system does for each requirement in handbook §11, where to find it,
and the steps to carry it out. Screen names, menu sections and button labels
are the ones the application actually shows.

Companion documents: [frs-traceability.md](frs-traceability.md) for the test
behind each requirement, [frs-walkthrough-script.md](frs-walkthrough-script.md)
for demonstrating them in a session.

---

## Finding your way

The sidebar has twelve sections. Everything below is written as
**Section → Screen**.

| Section | What lives there |
|---|---|
| **Home** | The dashboard: what needs attention, money, livestock |
| **AgriPro Core** | Populations and valuations — the biological asset register |
| *(species)* | One per module you run: Poultry, Snails, Fish, Dairy, Pigs, Goats, Rabbits |
| **Farm** | Houses, incubation, harvest readiness, mortality |
| **Buying** | Requisitions through to supplier invoices |
| **Selling** | Quotes through to customer receipts |
| **Store** | Stock, lots, counts, transfers, traceability |
| **Feed mill** | Milling, processing orders, recipes, standard costs |
| **People** | Staff, employees, leave |
| **Money** | Banking, payroll, timesheets, journals |
| **Books** | The ledger, statements, close, controls, tax |
| **Approvals** | Your queue, what you sent, delegations |
| **Setup** | Cost centres, breeds, GL accounts, approval rules, retention |

**Search is faster than the menu.** `Ctrl K` from anywhere, then type what you
want — "GRNI", "mortality", "trial balance". It searches screen names, hints
and keywords, so plain words find the right place.

**If a screen refuses you**, your role does not have it. That is the system
working: roles are least-privilege by design. Ask an administrator rather than
signing in as someone else.

---

## FR-MD-01 — Master data

*Effective-dated chart, cost centres, farms, warehouses, species, units, tax
and posting profiles. Invalid or expired combinations are blocked.*

| Feature | Where | How |
|---|---|---|
| Chart of accounts | **Setup → GL accounts** | See where each account sits on the balance sheet or P&L. A new farm is provisioned onto the approved five-digit chart automatically |
| Cost centres | **Setup → Cost centres** | **Add cost centre**. What a cost is attributed to |
| Breeds and stage ages | **Setup → Breeds** | **Add breed**, or **Load the standard list** to take the workbook's. Each breed carries the age in days at which each stage begins |
| Houses and pens | **Farm → Houses & pens** | Add a house, set its capacity with **Change**. See what is living in each |
| Items | **Store → Items** | **Add item** — everything the farm buys, stores or sells |
| Stores | **Store → Stores** | **Add store** — where stock physically sits |
| Vendors | **Buying → Vendors** | **Register vendor**; bank details are entered then **Verify**-ed |
| Customers | **Selling → Customers** | **Add customer** |
| Approval rules | **Setup → Approval rules** | Whether anyone may approve their own work |
| Preferences | **Setup → Preferences** | **Save settings** — language, units, feed lead times, thresholds |

**What the system enforces:** a posting whose cost centre, farm or dimension
is missing or expired is refused at entry, not discovered later.

---

## FR-WF-01 — Approvals

*Exceptions route to configured approvers. No self-approval where segregation
of duties applies.*

| Feature | Where | How |
|---|---|---|
| Approve what is waiting | **Approvals → Waiting on you** | Open a document, then **Approve** or send it back |
| Track what you raised | **Approvals → Sent by me** | What is still waiting, or has come back to you |
| See one document's history | **Approvals → Approval trail** | Who did what to it, and when |
| Lend your authority | **Approvals → Delegations** | **Grant delegation** to a colleague; **Revoke** ends it |
| Chase what has gone stale | **Approvals → Waiting on you** | **Run escalation sweep** — reminders and manager notification |

**What the system enforces:** the person who raised a document cannot approve
it. This is checked in the application and again by a database trigger, so it
holds no matter what writes the row.

---

## FR-PROC-01 — Procure to pay

*Requisition → order → receipt → invoice → payment, with three-way match.
The chain and its exceptions stay visible.*

**The flow, in order:**

1. **Buying → Requisitions** — **Raise the requisition** (what is needed,
   before a supplier or price is settled)
2. **Convert to a purchase order** from the requisition, or go straight to
   **Buying → Buy supplies** for an order
3. The order needs approval — it appears in the approver's **Waiting on you**
4. **Store → Goods received** — open the expected delivery and
   **Record the delivery** (the receive form carries the order's id, so reach
   it from this list rather than typing a path)
5. **Buying → Invoices** — **Enter the invoice**; this is where three-way
   match happens
6. **Record the payment** against the invoice

| Also here | Where |
|---|---|
| What has been ordered and what needs approving | **Buying → Purchase orders** |
| Change an order already sent | **Save and send for approval**, or **Send unchanged** |
| Goods back to a supplier | **Buying → Returns** — and the debit note |
| Which suppliers deliver short, late or rejected | **Buying → Delivery performance** |
| What each cost centre may commit | **Buying → Budgets** — **Set budget** |

**What the system enforces:** GRNI clears to zero. Goods received but not yet
invoiced sit in that account and come out when the invoice matches — the
identity finance checks first.

---

## FR-INV-01 and FR-INV-02 — Stock

*Perpetual quantity and value by item, lot and location. No negative stock.
Weighted average recalculated on receipt, frozen at issue.*

| Feature | Where | How |
|---|---|---|
| What is on hand | **Store → What we have** | Feed, medication and produce, with value and what is below reorder |
| Lots and expiry | **Store → Lots and expiry** | What each lot holds, its use-by date, what is quarantined |
| Count a store | **Store → Stock counts** | Count against book. **Differences post only once someone else approves** |
| Move or remove stock | **Store → Transfers & write-offs** | **Issue transfer** between stores; **Request write-off** with a reason; the receiving store confirms with **Receive** |
| Trace a lot | **Store → Trace a lot** | **Trace** — from a sale back through processing and harvest to the animals, their feed and treatments, and the goods receipt and supplier of every input. **Download CSV** for the same chain |

**What the system enforces:** cost is recalculated on each eligible receipt
and frozen at the moment of issue. A write-off needs a second person. Stock
cannot go negative.

---

## FR-LIFE-01 to FR-LIFE-04 — Lifecycle

*Cohorts and batches with genealogy; laying without derecognition; egg set
reconciles before a hatch approves; incubation readings alert.*

**The daily round is the main screen for farm staff.** Go to your species
section (**Poultry**, **Snails**, …) → **Daily round**. Record feed,
mortality, weights and eggs for the day, then **Submit round**. **Start over**
clears it if you have gone wrong. One round per batch per day.

| Feature | Where | How |
|---|---|---|
| Start a batch | Species section → new batch | The intake is called a *placement* for poultry and a *stocking* for snails, and the screen uses that word. Opening quantity, source, hatch date, and whether that date is exact or estimated |
| See a population | Species → **Live birds** / **Live snails** | Opening, what came in, deaths, sales, what is alive now |
| Eggs | **Poultry → Eggs today**, and **Farm → Incubation log** | Collection; then setter temperature, humidity and candling |
| Hatch | **Farm → Incubation log** | A set must name an incubator **with room for the eggs**. Readings outside the standard must be acknowledged before the hatch |
| Breeding (snails) | Species section → breeding | Record a cycle; **Record as failed** if it did not take |
| Mortality and culls | **Farm → Mortality and cull** | By batch, cause and stage, with survival. Normal against abnormal |
| Stage change | Species section → stage change | Move a batch to its next stage. The system **suggests** a stage from age and breed thresholds and flags a mismatch — it does not move animals on its own |
| Treatments | Species section → treatment | Withdrawal periods follow from it |
| Ready to harvest | **Farm → Ready to harvest** | Age, weight, stage, health and withdrawal for every batch |
| Harvest | **Farm → Ready to harvest** → record harvest | Moves live weight into processing |
| Close a batch | Species section → **Close batch** | Only when quantity is zero and every event is posted |

**What the system enforces:**

- Laying does not reduce the breeder flock — no derecognition from laying alone
- Eggs set must equal hatched plus unhatched plus approved loss, and the hatch
  cannot be approved until it does
- A population can never go below nothing — a database constraint, not only a
  screen check
- Weights are history: a reading is never overwritten. A wrong one is
  rejected and a new one recorded, and exactly one reading is current

---

## FR-BA-01 and FR-BA-02 — Biological assets

*Stage transfer, mortality and valuation evidence; roll-forward ties. FVLCTS
under policy, with override reasons.*

| Feature | Where | How |
|---|---|---|
| The register | **AgriPro Core → Populations** | Every population's carrying value, mortality and stage transfers, against the ledger |
| Raise a valuation | **AgriPro Core → Valuations** | **Raise valuation** — fair value less costs to sell, per population |
| Market price | **AgriPro Core → Valuations** | **Set price** feeds the valuation |
| Record a reliability review | Valuation screen | **Record review** — IAS 41's cost exception needs a dated reassessment of whether fair value is still unreliable |
| What each population made | **Money → What each population made** | Profit and cost per flock or cohort, best and worst |

---

## FR-SALES-01 — Order to cash

*Quotation, order, credit, dispatch, invoice, receipt, return — all journals
traceable.*

1. **Selling → Record a sale** — **Record sale** (birds, snails, eggs, produce)
2. Approval, if the amount or credit position needs it
3. **Selling → Ship goods** — enter what is going out against the approved order
4. **Selling → Invoices** — **Raise invoice**
5. **Record the receipt** when the customer pays

| Also here | Where |
|---|---|
| What has sold and what is owed | **Selling → Sales** |
| What shipped, and the entry each made | **Selling → Deliveries** |
| Margin by product and customer | **Selling → Sales margin** |
| A customer's statement | **Selling → Customers** → **Show** |

---

## FR-MFG-01 to FR-MFG-03 — Feed mill and processing

*BOM, routing and versions; WIP with outputs, by-products and loss; variances
cleared at close.*

| Feature | Where | How |
|---|---|---|
| Recipes | **Feed mill → Recipes** | **Create recipe**, **Add component**, **Add operation**, then **Activate this version**. Only a released version can post |
| Work out a batch | Recipe screen | **Work it out** explodes the recipe for a quantity |
| Standard costs | **Feed mill → Standard costs** | The year's policy, and each product's standard rolled from recipe and routing — six parts: material, packaging, labour, machine, overhead, depreciation |
| Cost pools | **Feed mill → Cost pools** | **Create pool**, **Save sources**, **Set rate** — overhead grouped by what drives it |
| Machine hours | Cost pool screen | **Save hours** — the driver for absorption |
| Run a processing order | **Feed mill → Processing orders** | Create the order against a source batch; issue stock; record outputs and losses |
| Joint costs | **Feed mill → Joint-cost prices** | **Propose price** — the approved prices that split one order's cost across its outputs |
| Actual feed cost | **Feed mill → Feed mill** | **Freeze and allocate** closes the actual-cost run |
| Feed plan | **Feed mill → Feed plan** | **Plan** — what the flocks will eat against stock and milling |
| Feed quality | **Feed mill → Feed quality** | Protein, moisture and aflatoxin limits a milled feed must meet |
| What an order returned | **Feed mill → Yield and profitability** | Live weight in, products out, cost and value |

**What the system enforces:** an order cannot close with an unexplained
balance. WIP and recovery clear, or the close refuses.

---

## FR-HR-01 and FR-HR-02 — People and payroll

*Employee, contract, bank, tax and pension IDs with effective dates and logged
access. Time approved, payroll calculated, labour allocated, liabilities paid.*

| Feature | Where | How |
|---|---|---|
| Add someone | **People → Employees** | **Add employee** — onboarding in four steps; the screen says what still blocks each person from payroll |
| See a bank or tax number | Employee record | **Show full numbers**. Numbers are masked by default and **every reveal is logged** to the audit trail |
| Pay details | Employee record | **Save** the pay; **Activate for payroll** when complete |
| Invite a user | **People → Staff** | **Create invitation**; **Withdraw** cancels it |
| Leave | **People → Leave** | Requests, approvals, balances carried forward, and what they are worth |
| Timesheets | **Money → Timesheets** | **Save hours** against each batch, then **Approve**. Overlapping shifts and time on a closed order are refused — at entry and again at approval |
| Payroll rates | **Money → Payroll setup** | **Activate payroll** turns on the current PAYE, pension, NHF, NSITF and ITF rates |
| Run payroll | **Money → Payroll runs** | **Create and calculate**, then **Submit for approval**, then post |
| Pay it | Payroll run | **Raise payment**; **Money → Bank payment files** gathers posted transfers into one file for the bank |
| Check it ties | **Money → Hours and pay** | Approved hours against the run, and the register against what batches were charged |

> **One gap to know about.** Staff bank and statutory numbers are encrypted at
> rest only when `PII_ENCRYPTION_KEY` is set on the server. Until it is, they
> are stored as typed and the API warns at every start-up. Access logging
> works either way.

---

## FR-GL-01 to FR-GL-03 — Ledger and close

*Balanced, idempotent, dimensional journals with drill-through and reversal.
Locked periods refuse postings. Close carries balance-sheet accounts only.*

| Feature | Where | How |
|---|---|---|
| Every posting | **Books → Journal entries** | With what caused it — click through to the source document |
| Raise a manual journal | **Money → Journals** | **Raise and send for approval**. **Create template** sets up a recurring accrual or prepayment; **Generate due journals** issues them |
| Correct something posted | **Books → Journal entries** | **Confirm reverse**. A posted entry is never edited — reversal is the only correction path |
| Close a period | **Books → Period close** | **Prepare checklist**, work the validations, **Approve** |
| Reopen a period | **Books → Period close** | **Request reopen**, then **Reopen** once approved. Every reopen shows in the audit trail |
| Year end | **Books → Year-end close** | Sweeps the result to retained earnings and opens the next year |
| Controls | **Books → Controls** | Control-account reconciliation, posting checks, and **Sign off** for release |
| Posting rules | **Books → Posting rules** | Every business event and the debit and credit it makes |
| Audit trail | **Books → Audit trail** | Who did what, when, and what changed — before and after |
| Tax | **Books → Tax** | VAT and WHT registers, reconciliation, **Close period**, filing calendar |

---

## FR-RPT-01 — Reports

*P&L, balance sheet, cash flow, trial balance, GL, ageing, BA, WIP, inventory,
payroll and KPIs — with parameters, drill-through and export.*

All under **Books**:

| Report | What it gives |
|---|---|
| **Trial balance** | Every account and its balance; filter by branch, cost centre or farm, and click an account through to the journals behind it |
| **Profit & loss** | Revenue through to profit after tax |
| **Balance sheet** | What the company owns, owes and is worth |
| **Cash flow** | Direct and indirect side by side, both agreeing with the balance sheet's cash |
| **AR ageing** / **AP ageing** | Who owes, who is owed, how overdue |
| **Depreciation schedule** | Each asset's charge, expensed or absorbed, against the ledger |
| **Fixed assets** | The register. **Capitalise** an asset, **Run depreciation**, **Send for approval** to dispose |
| **KPIs** | Nine measures, each computed or explicitly marked as not |
| **Farm costing** | Egg value, and wages and overheads shared across flocks and cohorts |
| **Farm ABC** | What each lifecycle stage cost, and what live sales and processing carried |
| **Reports** | Every report this company can run, in one place |

**Money → Watching for losses** is worth knowing: where the farm is losing
money and why, with a feed tolerance and what each loss is worth.

---

## FR-AUD-01 — Audit

*Immutable create, change, approve, post and reverse logs with before and
after values.*

**Books → Audit trail.** Every action by every person, with what changed.
Delete is disabled entirely — nothing in the ledger can be removed, only
reversed. **Setup → Record retention** says how long each kind of record is
kept and flags what is past its minimum; it deletes nothing on its own.

---

## Two things the system does not do

Worth knowing before someone asks.

**Responsible Supervisor.** The specification asks for a named accountable
owner on each cohort or flock. The system records who entered and who approved
every event, but no standing owner for the batch. The in-app glossary says so.

**Authenticator MFA.** Built — enrollment, recovery codes, replay protection —
but enforcement was switched off on 20 October pending a test of the setup,
verification and recovery flow. Privileged roles currently sign in with a
password alone.

---

## When something will not let you

| What you see | What it means |
|---|---|
| A permission page | Your role does not include that screen. Least privilege is deliberate |
| "Needs one of…" | The action needs a role you do not hold — ask an approver, do not switch accounts |
| A posting refused for a dimension | The cost centre, farm or branch is missing or expired. Fix the master, not the posting |
| A close that will not complete | Work the checklist on **Period close**; it names what is unreconciled |
| An order that will not close | WIP or recovery has a balance that is not explained |
| A sign-in that takes a minute | The server sleeps when idle and takes 53–56 seconds to wake. It is not broken |
