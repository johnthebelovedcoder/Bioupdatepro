# Control gap register

A sweep of the client's workbook control sheets against the application, row
by row: **Acceptance_v2**, **Acceptance_Criteria**, **Costing_Policy_v2**,
**STANDARD_COST_CHECKS** and **SYSTEM_INTEGRITY_MATRIX** (2026-09-26).

Status:

- **Built**: enforced by the application, with an automated test as evidence.
- **Built 26 Sep**: a gap this sweep found and closed.
- **Partial**: the core rule is enforced; the part named is not.
- **Not built**: needs a decision or a larger build.

Tests are in `apps/api/test/integration/`. Run them with
`npm run test:integration --workspace @bioassetpro/api`.

## Summary

| Status | Rows |
|---|---|
| Built | 63 |
| Built 26 Sep | 8 |
| Partial | 14 |
| Not built | 2 |

88 rows; AC-001, a check on the workbook itself rather than the application, is not counted.

**Not built:** leave (AC-HR-003) and end-to-end lot traceability (AC-011). **Missing parts of partial rows**, the larger ones:
the direct-method cash flow (AC-013 / AC-ENT-001), multi-factor sign-in
(INT-034), purchase budgets (INT-002), bank verification before paying
(INT-005 / INT-015), WhatsApp with consent (AC-015), and a single
depreciation schedule report (AC-MFG-009 / POL-010).

## Built 26 Sep

The fixes this sweep and the two before it made (the last two also answer
rows marked Built above):

| Row | What now happens | Evidence |
|---|---|---|
| POL-005 / POL-006 | Normal loss above the recipe's approved yield is refused; the excess must be recorded as abnormal loss, which is expensed rather than carried in finished goods | production-order.spec: "keeps normal loss within the recipe's approved yield" |
| AC-MFG-008 | The sample's ₦26,000 snail and ₦40,000 poultry variances reproduce, with recovery at zero | production-order.spec and poultry-processing.spec: "shows the ₦26,000 / ₦40,000 … variance" |
| INT-001 | A second supplier with the same TIN or bank account, or a second customer with the same TIN, is refused | masters.spec: "refuses a second supplier with the same TIN or bank account" |
| INT-012 / AC-HR-001 | A bank account or TIN already on another employee is refused, at creation and on edit | masters.spec: "refuses a ghost employee" |
| INT-012 | Whoever set up an employee cannot also activate them for payroll | masters.spec: "is activated for payroll by someone other than whoever set the employee up" |
| INT-009 | Stock counts: the store frozen while counted, a recount beyond the threshold, a reason for every difference, and approval by someone other than the counter before anything posts (Dr/Cr 640100 and inventory, PCR-014) | stock-count.spec |
| AC-PAY-002 | Neither the preparer nor the approver of a payroll run can pay it | payroll.spec: "is paid by neither whoever prepared the run nor whoever approved it" |
| POL-001 tolerance | A total variance beyond the year's tolerance settles only with a reason | standard-costing.spec: "settles a variance beyond the year's tolerance only with a reason" |
| POL-003 | Standards carry six parts: material, packaging, labour, machine, overhead, depreciation | standard-costing.spec: "reports the six parts of POL-003" |

Where a company has chosen self-approval (a one-person farm), the three
maker-checker rules above allow the same person and record it, as every
other approval does.

## Acceptance_v2

| ID | Requirement | Status | Evidence / what is missing |
|---|---|---|---|
| AC-HR-001 | Duplicate identity/bank or unapproved change blocked | Built 26 Sep | Duplicates refused; pay changes need a second person's approval (masters.spec: "pays nothing until someone else approves the change") |
| AC-HR-002 | Approved hours reconcile to payroll and cost-object allocation | Partial | Only approved hours allocate to cost objects (farm-costing.spec: "counts only approved hours"). There is no report reconciling hours to the payroll run. |
| AC-HR-003 | Leave balance roll-forward and payroll effect | **Not built** | No leave module |
| AC-PAY-001 | Gross = earnings; net = gross − deductions; journal = approved payroll | Built | payroll.spec: "calculates EMP001 exactly", "posts the §7 accrual" |
| AC-PAY-002 | Preparer cannot approve or pay the same run | Built 26 Sep | Maker ≠ approver (workflow, and a database trigger); payment by preparer or approver refused |
| AC-PAY-003 | Payroll liabilities clear to remittance | Built | payroll.spec: "clears the salary payable", "clears the PAYE payable separately" |
| AC-MFG-001 | Only released effective BOM/routing versions used | Built | masters.spec: "refuses to explode a draft version"; standards roll up from released rates only |
| AC-MFG-002 | Costing method Standard only, locked after setup | Built | standard-costing.spec: "locks it at the first posting (AC-MFG-002)" |
| AC-MFG-003 | Setup once per order; run time × approved driver | Built | production-order.spec: "works out standard conversion from the routing" |
| AC-MFG-004 | Pool source GL = allocated + unused capacity | Partial | Unused capacity is shown for each pool. A pool's cost is entered with its rate, not read from the GL, so the pool is not tied to the GL. |
| AC-MFG-005 | Input = good output + by-product + normal + abnormal loss | Built | production-order.spec: "only when the quantities balance" |
| AC-MFG-006 | Completed order WIP = 0 | Built | settlement asserts the WIP identity; processing specs check 130410/130420/130430 = 0 |
| AC-MFG-007 | S_Recovery and P_Recovery reconcile separately | Built | poultry-processing.spec: Controls reconciliation of 1304/2198 |
| AC-MFG-008 | Snail ₦26,000 and poultry ₦40,000 variances | Built 26 Sep | see above |
| AC-MFG-009 | FA depreciation = P&L + absorbed manufacturing depreciation | Partial | Depreciation splits to processing lines by machine hours, and the register agrees with the ledger (fixed-assets.spec). There is no single report showing the three figures side by side. |
| AC-ENT-001 | Direct and indirect cash flow both equal SOFP cash | Partial | Indirect method ends at the bank balance (cash-flow.spec); the direct method is not built |

## Acceptance_Criteria

| ID | Requirement | Status | Evidence / what is missing |
|---|---|---|---|
| AC-001 | Every SOP row has FRS, report, KPI, actor, screen, exit | n/a | A check on the workbook itself |
| AC-002 | Separate responsible and approver roles | Built | workflow maker ≠ approver, plus a database trigger (workflow.spec) |
| AC-003 | GRN and invoice separate balanced journals | Built | procurement.spec: "THE IDENTITY: GRNI clears to zero" |
| AC-004 | Valid cost centre and dimensions required | Built | posting.spec: "rejects a posting missing a mandatory dimension" |
| AC-005 | Snail opening + additions − mortality − transfers = closing | Built | biological-lifecycle.spec; database triggers (110) |
| AC-006 | Poultry placed − mortality − harvest = closing | Built | placement.spec, biological-lifecycle.spec |
| AC-007 | FVLCTS = quantity × (market − CTS), no disposed units | Built | biological valuation tests; disposed animals are excluded |
| AC-008 | Receipts recalculate moving average; issues freeze cost | Built | inventory.spec |
| AC-009 | WIP inputs − outputs − loss/variance = 0 | Built | settlement WIP identity |
| AC-010 | Recovery GLs reconcile by order and period | Built | as AC-MFG-007 |
| AC-011 | Sale lot traces to harvest, cohort, GRN and inputs in one query | **Not built** | No lot genealogy. Sales link to a population where one is named, but there is no end-to-end trace. |
| AC-012 | Reports tie to subledger, journal and GL | Built | reports.spec; Controls reconciliation |
| AC-013 | Direct and indirect cash flow agree with SOFP | Partial | as AC-ENT-001 |
| AC-014 | Posted records immutable; correction by reversal | Built | posting.spec: "reversal is the only correction path" |
| AC-015 | Email/WhatsApp to verified, consenting recipients | Partial | Email notifications and invitations exist. WhatsApp and the consent/verified-recipient control are not built. |

## Costing_Policy_v2

| ID | Rule | Status | Evidence / what is missing |
|---|---|---|---|
| POL-001 | Standard cost only, locked for the year | Built | standard-costing.spec |
| POL-002 | Perpetual moving weighted average | Built | inventory.spec |
| POL-003 | Standard = BOM + routing + rates, six parts | Built 26 Sep | standard-costing.spec |
| POL-004 | Actual cost for variance only | Built | actual cost never posts to WIP or finished goods |
| POL-005 | Normal loss absorbed within standard | Built 26 Sep | see above |
| POL-006 | Abnormal loss expensed, not hidden in FG | Built | abnormal loss approval and posting (production-order.spec) |
| POL-007 | Joint cost by approved driver | Built | production-order.spec: joint-cost tests |
| POL-008 | Separate recovery GL per species | Built | 219810 / 219820 / 219830 |
| POL-009 | Variance disposition: COGS / FG / closing WIP | Partial | Variances go to cost of sales, the only disposition the policy offers. Proration to finished goods or closing WIP is not built. |
| POL-010 | FA schedule = P&L + absorbed depreciation | Partial | as AC-MFG-009 |

## STANDARD_COST_CHECKS

All 13 rows are **Built**: the costing method is fixed to Standard; the
approved decision is recorded as the costing policy; the snail and poultry
standard, actual and variance totals reproduce (AC-MFG-008); and WIP and
recovery close to zero for both species.

## SYSTEM_INTEGRITY_MATRIX

| ID | Area | Status | Evidence / what is missing |
|---|---|---|---|
| INT-001 | Supplier/customer master | Built 26 Sep | Duplicate TIN or bank account refused. A supplier's bank change does not yet need a second person's approval. |
| INT-002 | Purchase order | Partial | Approval, dimensions and blocked suppliers are enforced; budget checks are not built |
| INT-003 | Goods receipt | Built | Receipt against an open PO; over-tolerance goes to exception approval |
| INT-004 | Supplier invoice | Built | Unique supplier invoice number; three-way match |
| INT-005 | Supplier payment | Partial | Over-allocation refused and maker ≠ checker; no bank verification before payment |
| INT-006 | Stock receipt | Built | inventory.spec |
| INT-007 | Stock issue | Built | Per-store availability; moving average frozen at posting |
| INT-008 | Stock transfer | Built | Source and destination move together (inventory.spec); lots as AC-011 |
| INT-009 | Stock count adjustment | Built 26 Sep | Count freeze (also in the database), recount beyond a threshold, a reason for every difference, counter ≠ approver, hold for investigation, posted through PCR-014 (stock-count.spec) |
| INT-010 | Asset capitalisation | Built | fixed-assets.spec |
| INT-011 | Depreciation/disposal | Built | fixed-assets.spec: "never depreciates an asset before it is in service" |
| INT-012 | Employee activation | Built 26 Sep | Employee_Master_Checks; duplicates refused; activation by a second person |
| INT-013 | Time capture | Partial | Approved hours, at most 24 a day; overlapping shifts and time on closed orders are not checked |
| INT-014 | Payroll calculation | Built | One run per month; negative net pay refused; approved pay only |
| INT-015 | Payroll payment/remittance | Partial | Paid per liability bucket, never beyond what is owed, by someone other than preparer and approver; no bank verification |
| INT-016 | Configure annual standard | Built | Costing policy and standard-cost workbench |
| INT-017 | Capture actual resources | Built | Actual cost tied to source (payroll, depreciation, pools) |
| INT-018 | Absorb/settle production | Built | Recovery clears; variances classified; tolerance enforced |
| INT-019 | Snail breeders/cohort | Built | Database triggers; lifecycle tests |
| INT-020 | Egg laying/hatching | Built | snail-breeding.spec: "refuses a hatch that does not account for every egg" |
| INT-021 | Snail mortality | Built | Mortality at most the live count; approved events only |
| INT-022 | Snail processing | Built | Mass balance, WIP and recovery zero |
| INT-023 | Poultry placement | Built | placement.spec: duplicate batch code, pen capacity |
| INT-024 | Feed/mortality/weight | Built | Feed at most the stock in store; mortality at most live birds; weighings approved |
| INT-025 | Egg collection/incubation | Partial | Eggs valued and carried by flock; incubator capacity is not checked |
| INT-026 | Poultry processing | Built | poultry-processing.spec |
| INT-027 | Feed mill | Built | Released formula; stock availability; yield at standard |
| INT-028 | Customer invoice | Built | Unique invoice numbers; credit control; tax |
| INT-029 | Customer receipt | Built | Receipt allocation never beyond what is outstanding |
| INT-030 | Journal posting | Built | Balanced, open period, dimensions, maker ≠ approver, idempotent |
| INT-031 | TB and statements | Built | Built from postings, never typed balances; reconciliations |
| INT-032 | Month close | Built | closing.spec |
| INT-033 | Year close | Built | closing.spec |
| INT-034 | Security/audit | Partial | Role-based access; append-only audit (posting.spec: "never permits an audit record to be updated or deleted"). Multi-factor sign-in is not built. |
