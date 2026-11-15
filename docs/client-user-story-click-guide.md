# BioAssetPro client guide — finding the user stories

This guide maps the 26 stories in the UAT register to the screens a client can
open and the normal workflow to demonstrate. It is a navigation guide, not a
claim that every automated acceptance check has a visible screen.

The paths below use the application’s current menu and page labels. A menu or
action may be hidden when the signed-in user’s role does not have access.
The paths were checked against the application source; they have not all been
walked through against a live client account, and the availability of each
workflow depends on permissions, configuration, and usable records.
Select **Poultry** or **Snails** in the species switcher before using a species
workflow; names such as **Flocks** and **Cohorts** change with that selection.

## Before the session

- Sign in with an account for the role being demonstrated. Do not share
  administrator credentials or use another person’s account.
- Confirm the company, farms, financial periods, species module, houses/pens,
  active supervisors, approved breeds, stores, items, suppliers, customers,
  employees, and approval rules needed for the scenarios are configured.
- Use a sandbox or training company for demonstrations that create, post,
  reverse, approve, close, or deliberately reject transactions. Do not create
  invalid or duplicate records in a live company to demonstrate a control.
- The **Approvals** section is where approvers review work. A user who cannot
  see a menu or action should ask an administrator to confirm their role; do
  not switch to another user’s account.
- The latest recorded UAT scorer result (14 November 2026) is 25 PASS and one
  PASS + MANUAL; **UAT-026 still requires observed UX acceptance** with a farm
  worker, supervisor, and finance user. This is not a live-app validation or
  client sign-off.

## Story click paths

### UAT-001 — User and role setup

**Open:** **People → Staff** (**Staff & roles**). This user-access screen is
available to Administrator, CFO, Farm Manager, and System Administrator
accounts. Other staff roles use **People → Employees** for employee workflows:

1. Select **Invite someone**, enter the person’s email, choose from the roles
   the signed-in user is allowed to grant, and select **Create invitation**.
2. Copy the one-time invitation link or choose **Send on WhatsApp**. The invite
   appears in the invitation list; a pending invite can be withdrawn.
3. In **People**, review each user’s roles and status. For another user, select
   **Edit roles**, **Reset password**, **Deactivate**, or **Reactivate** as
   needed. Users cannot change or deactivate their own account from this table.

Role choices are enforced by the API as well as filtered in the screen:
**Administrator** may grant any of the 24 supported roles; **CFO** may grant
any role except Administrator; **Farm Manager** may grant Farm Attendant,
Snail Supervisor, Poultry Supervisor, Production Supervisor, Production Lead,
and Storekeeper; **System Administrator** may grant those operational roles
plus QA Officer and System Administrator. Farm Managers cannot grant QA roles;
System Administrators cannot grant finance, HR, approval, or audit roles. An
already assigned role can be retained or removed when editing a user even if
the current administrator cannot newly grant that role.

**Role reach:** Open **Setup → Overview → Role access** to review or change
which sidebar sections a role can reach. This is a navigation setting only; it
does not grant or revoke the API’s underlying action permissions.

**Demonstrate:** Sign in separately with representative role accounts and show
the sections and actions available to each. Any restricted-action refusal
should be shown only in a sandbox and reviewed in **Books → Audit trail** where
available.

**Note:** The invitation, user-management, and role-section controls are
restricted to authorized roles. The staff screen shows the roles supported by
the application and which the signed-in administrator may assign. User
administration does not edit a user’s email, and changing a sidebar section is
not a substitute for testing the API’s authorization and maker-checker
controls.

### UAT-002 — Master data and dimensions

**Open:** **Setup → Cost centres**, **Setup → GL accounts**, **Setup → Breeds**,
and **Farm → Houses & pens**.

**Demonstrate:** Review the active master values and dimensions used in a
permitted transaction. To show that inactive or missing dimensions are
rejected, use an approved sandbox scenario and review the resulting message;
do not alter production masters merely to force a failure.

### UAT-003 — Approval workflow

**Open:** **Approvals → Sent by me**, **Approvals → Waiting on you**, and
**Approvals → Approval trail**.

**Demonstrate:** Submit a supported document for approval, sign in as the next
approver, approve it, and show its status and retained history. Maker
self-approval is a negative-path check; use a sandbox account pair and do not
try to bypass the workflow by editing records directly.

### UAT-004 — Audit trail and numbering

**Open:** **Books → Journal entries** and **Books → Audit trail**. For a
reversal demonstration, open an eligible posted journal and use its available
reversal action.

**Demonstrate:** Show the controlled reference on a posted document, its audit
entry, and the linked reversal when applicable. Duplicate-number races,
duplicate replay, deletion prevention, and duplicate reversals are automated
control checks, not routine client actions; only demonstrate them in a
disposable sandbox.

### UAT-005 — Purchase-to-pay

**Open:** **Buying → Requisitions → Purchase orders → Invoices**. Receive the
goods through **Store → Goods received**. For payment and settlement, use
**Money → Banking** and the relevant supplier/payment record.

**Demonstrate:** Raise and approve a requisition or order, record the goods
received, match the supplier invoice, and follow the payment status. The
supplier ageing is available in **Books → AP ageing**. Over-billing,
duplicate supplier invoice numbers, blocked suppliers, and over-receipts are
controlled exception scenarios; test these in the sandbox only.

### UAT-006 — Inventory control

**Open:** **Store → What we have**, **Store → Goods received**,
**Store → Transfers & write-offs**, and **Store → Stock counts**.

**Demonstrate:** Receive stock, transfer it between stores, complete a count,
and review the updated balance. Compare with **Books → Controls** and the
inventory-related ledger balances when the company’s control-account setup is
complete. A negative-stock refusal should be demonstrated only with a
sandbox record.

### UAT-007 — Fixed assets

**Open:** **Books → Fixed assets** and **Books → Depreciation schedule**.
Follow the available asset action to add or capitalise an eligible asset, then
review its register entry and depreciation schedule.

**Demonstrate:** Use an asset that is ready for its in-service date and
approval. The “before in service” and duplicate-month depreciation checks are
negative tests; do not make those entries in the live ledger.

### UAT-008 — Payroll and statutory liabilities

**Open:** **People → Employees**, then **Money → Payroll setup**,
**Money → Hours and pay**, and **Money → Payroll runs**. Use **Money → Banking**
or **Money → Bank payment files** for a posted payroll payment.

**Demonstrate:** Review an active employee and payroll setup, enter or approve
hours as appropriate, create and calculate a payroll run, submit it through
approval, post it, and inspect its payment status. Inactive-employee and
unposted-run payment refusals are sandbox checks.

### UAT-009 — Order-to-cash

**Open:** **Selling → Record a sale**, **Selling → Deliveries**,
**Selling → Invoices**, then **Money → Banking** for receipts. Review balances
in **Books → AR ageing**.

**Demonstrate:** Create an eligible sale, record its delivery, invoice the
shipped quantity, and apply a customer receipt. A credit-limit override,
blocked-customer refusal, or other exception must be shown in a sandbox.

### UAT-010 — Snail acquisition and cohort setup

**Open:** Select **Snails → Cohorts**, then choose **New Cohort**. Confirm
housing in **Farm → Houses & pens** first.

**Demonstrate:** Enter a unique cohort code, approved breed, purpose, pen,
opening population, date, origin evidence, responsible supervisor, and any
applicable acquisition cost. Confirm the new cohort in the register. Duplicate
codes and over-capacity placements are negative-path sandbox checks.

### UAT-011 — Snail egg-to-hatchling lifecycle

**Open:** Select **Snails → Breeding**.

**Demonstrate:** Record a breeding cycle for an eligible breeder cohort. When
the cycle is ready, record the hatch, account for the eggs, and confirm the
hatchling cohort in **Snails → Cohorts**.

**Note:** The current client screen shows snail breeding cycles; this is
separate from poultry’s **Incubation** screen. Use an approved cycle and
realistic egg/hatch counts. Excess hatch counts, incomplete egg accounting,
excess breeder counts, or a second hatch are sandbox negative-path checks.

### UAT-012 — Age and stage transfer

**Open:** Select **Poultry → Flocks** or **Snails → Cohorts**, open a
population’s record, and use the available stage-change action. Review stage
and age in the register; **Farm → Ready to harvest** provides a readiness
view.

**Demonstrate:** Use a population old enough for its intended next stage and
show the resulting register state. An age-ineligible stage change is a
sandbox-only negative test.

### UAT-013 — Snail feed, mortality, and cost capture

**Open:** Select **Snails → Daily round**. Review feed totals in
**Snails → Feeding** and loss records in **Farm → Mortality and cull**.

**Demonstrate:** Record feed and mortality for an open cohort, submit the
round, and review the resulting records. For inventory-backed feed costing,
confirm the item has been received into the relevant store first. Excess
mortality and abnormal-loss approval are sandbox checks; do not create
artificial losses in a live farm.

### UAT-014 — IAS 41 valuation

**Open:** **AgriPro Core → Populations** and **AgriPro Core → Valuations**.
Use **Approvals → Waiting on you** to review a valuation awaiting approval.

**Demonstrate:** Review an eligible population, prepare a valuation with its
required price and evidence, submit it for approval, then show its approval
status and updated valuation history. Disposed-unit and missing-evidence
refusals should only be demonstrated with sandbox data.

### UAT-015 — Snail processing and standard costing

**Open:** **Feed mill → Processing orders**. Supporting setup and costing
destinations include **Feed mill → Recipes**, **Feed mill → Cost pools**,
**Feed mill → Standard costs**, and **Feed mill → Joint-cost prices**.

**Demonstrate:** In a configured sandbox, follow the order’s available
issue, conversion, output, and settlement steps, then review order results in
**Feed mill → Yield and profitability**. Do not close a real order merely for
a demonstration. WIP remaining at close and reusing a harvest are
negative-path checks.

### UAT-016 — Poultry acquisition and flock setup

**Open:** Select **Poultry → Flocks**, then choose **New Flock**. Confirm
housing in **Farm → Houses & pens** first.

**Demonstrate:** Enter a unique flock code, approved breed, purpose, house,
opening population, date, origin evidence, responsible supervisor, and any
applicable acquisition cost. Confirm it in the Flocks register. Duplicate
codes and house-capacity breaches are sandbox negative-path checks.

### UAT-017 — Flock age, stage, and mortality

**Open:** Select **Poultry → Daily round** to record routine flock entries.
Use **Poultry → Health** for available health/treatment records and
**Farm → Mortality and cull** to review losses.

**Demonstrate:** Record an ordinary daily round and inspect the flock’s
population and mortality. Age and stage are visible from **Poultry → Flocks**.
An over-counted death or abnormal-loss approval path should only be exercised
in a sandbox.

### UAT-018 — Feed, weight samples, and FCR

**Open:** Select **Poultry → Daily round** to record feed and a weight sample;
review the resulting metrics in **Poultry → How they are doing** and feed
records in **Poultry → Feeding**.

**Demonstrate:** Use an available feed item, record a representative weight
sample, submit the round, and review the FCR and weight history. The
unavailable-feed and implausible-weighing refusals are sandbox checks.

### UAT-019 — Egg production and hen-day

**Open:** Select **Poultry → Daily round** to record egg collection. Review
collection totals in **Poultry → Eggs**, hatchery activity in
**Poultry → Incubation**, and performance in **Poultry → How they are doing**.

**Demonstrate:** Record a normal collection with the applicable grades and
destination, then review the production and hen-day figures. Do not submit a
second round for the same flock and date in a live company; duplicate-shift
prevention is a sandbox negative test.

### UAT-020 — Poultry processing and standard costing

**Open:** **Feed mill → Processing orders**, with supporting setup in
**Feed mill → Recipes**, **Feed mill → Cost pools**, **Feed mill → Standard
costs**, and **Feed mill → Joint-cost prices**.

**Demonstrate:** Use an approved sandbox order and follow its available
issue, conversion, output, and settlement actions. Review **Feed mill → Yield
and profitability**. A close with remaining WIP is a negative-path sandbox
check.

### UAT-021 — GL and subledger reconciliation

**Open:** **Books → Controls**, **Books → AR ageing**,
**Books → AP ageing**, and **Books → Trial balance**.

**Demonstrate:** Review the control and reconciliation status for a balanced
period and compare the relevant subledger totals with the control accounts.
Do not deliberately create a mismatch in the live ledger; the close-blocking
test belongs in a sandbox.

### UAT-022 — Financial statements

**Open:** **Books → Trial balance**, **Books → Profit & loss**,
**Books → Balance sheet**, and **Books → Cash flow**. Use **Books → Reports**
for available report views and period/farm filters.

**Demonstrate:** Select the agreed reporting period and farm/segment filters,
then review the statements and confirm that the trial balance balances.
Draft-exclusion and case-study replay results are validation evidence, not
ordinary client clicks.

### UAT-023 — Reports and KPI lineage

**Open:** **Books → Reports**, **Books → KPIs**, and, for species metrics,
**Poultry → How they are doing**. Use the report’s available period and farm
filters.

**Demonstrate:** Select an in-scope farm and period, review the displayed
metrics, and trace the figures to their source records where the screen
provides that detail. Cross-company access and invalid-period refusals are
sandbox/security checks; do not attempt to open another client’s data.

### UAT-024 — Production-order close

**Open:** **Feed mill → Processing orders** and **Feed mill → Yield and
profitability**.

**Demonstrate:** In a sandbox, review the order’s issue, conversion, output,
WIP, recovery, and variance information before using its available settlement
or close action. A clean close requires the applicable balances to be settled;
do not close a live order as part of a tour.

### UAT-025 — Month/year close and period lock

**Open:** **Books → Period close** and **Books → Year-end close**.

**Demonstrate:** Review the checklist for a prepared test period and explain
which items block close. Perform close, lock, or reopen actions only in a
designated sandbox and with the required Finance approver. Posting into a
locked period and requester self-approval are negative-path tests.

### UAT-026 — Daily entry and next-step guidance

**Open:** Select **Poultry → Daily round** to record a daily entry, feed,
weight sample, and any relevant mortality details. Review **Poultry → Feeding**,
**Poultry → Health**, **Poultry → How they are doing**, and the outbox in the
application header as applicable.

**Demonstrate:** Ask a farm worker to enter a normal round, a supervisor to
review the resulting record, and a finance user to review its financial
effects. Observe whether validation messages explain what was entered and
what is allowed. UAT-026 remains open until this observed acceptance has been
completed and recorded; automated PASS results do not close it.

## Related documents

- [FRS feature guide](./frs-feature-guide.md) — broader feature instructions.
- [FRS walkthrough script](./frs-walkthrough-script.md) — suggested client
  demonstration agenda and facilitation notes.
- [UAT register](../apps/api/test/uat/register.json) — acceptance scenarios
  represented in the test register.
