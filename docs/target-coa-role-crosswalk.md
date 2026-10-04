# Application posting-role crosswalk to the selected five-digit chart

**Status:** engineering analysis; proposed targets are not Finance-approved. The balance cutover (`chart/approved-crosswalk.ts`) is built from it but refuses to run until Finance’s approval is recorded. The selected chart is the account master in `approved-posting-engine.json`; the final columns below identify the target handling required by each application role.

| Application role | Current six-digit target | Workbook target / handling | Status and evidence needed |
|---|---:|---|---|
| Bank | 110100 | 10100 | Direct control-account match; the bank subledger workflow accepts an active control account. Link and reconcile the actual bank account subledger; direct journal access remains prohibited. |
| Receivables | 120100 | 11000 | Direct control-account match; customer subledger remains authoritative. Verify sales/receipt flows post via the customer subledger and cannot be journaled directly. |
| Raw materials | 130100 | 12000; route feed, packaging, and consumables to 12100, 12200, and 12300 | Item-category mapping required; current `isBiologicalFeed` flag alone does not classify packaging and consumables. |
| Feed inventory | 130110 | 12100 | Direct purpose match; item subledger tie-out required. |
| Packaging | 130100 | 12200 | Target is identified by workbook class; update item setup/routing so packaging does not share raw-material code. |
| Input VAT | 125100 | 11300 | Direct control-account match; tax-code/subledger tie-out required. |
| WHT receivable | 125200 | 11400 | Workbook match is “Withholding tax receivable”; this target is not listed in the current draft crosswalk and needs adding/review. |
| PPE | 140100 | 15100 buildings; 15200 machinery; 15300 vehicles; 15400 furniture/equipment | Asset-class selection required per fixed-asset register; no single default. |
| Accumulated depreciation | 149100 | 15500 buildings; 15600 machinery; 15700 vehicles; no separate furniture/equipment target found | Match to the same asset class as gross cost; obtain an approved treatment for furniture/equipment and bearer plants. |
| Salary payable | 220100 | 20700 | Direct control-account match; the payroll subledger workflow accepts active control accounts. Reconcile payroll register and settlements; direct journal access remains prohibited. |
| Pension payable | 222100 | 20700 | Shared payroll control with mandatory statutory-deduction subledger dimension; payroll workflow accepts control-account posting. |
| NHF payable | 223100 | 20700 | Shared payroll control with mandatory deduction type/payee dimension; payroll workflow accepts control-account posting. |
| NSITF payable | 224100 | 20700 or 20200 | Classify employee/statutory deduction versus employer accrual by source transaction. |
| ITF payable | 224100 | 20700 or 20200 | Same liability-nature decision as NSITF; split from source schedule. |
| PAYE payable | 221100 | 20600 | Direct control-account match; tax-return/remittance tie-out required. |
| Output VAT | 226100 | 20400 | Direct control-account match; tax-code/subledger tie-out required. |
| WHT payable | 225100 | 20500 | Direct control-account match; tax-type/remittance tie-out required. |
| GRNI | 210200 | 20300 | Direct control-account match; retain receipt/invoice cut-off schedule. |
| Trade payables | 210100 | 20100 | Direct control-account match; supplier subledger tie-out required. |
| Retained earnings | 320100 | 30200 | Direct candidate; prior-period close and opening-equity bridge required. |
| Salary expense | 620100 | 52010 / 52020 / 52100 / 52110 / 52120, with 56000/56010 only for supported admin allocation | Split by employee, activity, and cost centre; do not direct all payroll to one code. |
| Employer pension expense | 620200 | Same labour/activity pool candidates as salary expense | Split using approved allocation basis and cost-centre dimensions. |
| NSITF/ITF expense | 620300 | Same labour/activity pool candidates as salary expense | Split by liability/source and approved allocation basis. |
| Operating expenses | 690100 | Workbook operating-expense posting codes by nature, including 56010 for core administration | No unique crosswalk row; retain natural-expense account and approved cost-centre mapping. |
| Depreciation expense | 630100 | 52400 | Direct purpose match; allocation between P&L and production recovery must reconcile. |
| Impairment loss | 630200 | Unresolved | No direct approved posting target identified; Finance must select the approved account and confirm IAS 36 presentation. |
| Finished-goods capitalised variance | 130590 | Allocate by product/item to approved inventory controls (e.g. 12410/12420), with variance accounts 53000–53600 | The workbook does not identify a separate inventory variance account; item-cost subledger and POL-009 schedule required. |
| WIP capitalised variance | 130595 | Allocate by processing stream to 13110/13120/13200; bridge source variance through 53000–53600 | Requires WIP/variance source schedule; do not create an unapproved GL code. |
| Poultry rearing cost | 130210 | 16032 immature / 16042 mature | Resolve by cohort stage at posting date; FVLCTS remeasurement follows IAS 41. |
| Snail rearing cost | 611000 (expense treatment) | 52610 feed; 52510 treatment | Resolve by source item/event; never post both to one account by default. |
| Abnormal poultry mortality | 640500 | 51120 | Direct purpose match; cost centre and cohort required. |
| Abnormal snail mortality | 640300 | 51110 | Direct purpose match; cost centre and cohort required. |
| Poultry live-bird COGS | 510300 | 50310 | Product-class mapping; verify egg SKUs do not route here. |
| Snail live-animal COGS | 510100 | 50210 | Product-class mapping; harvested products use their own COGS target. |
| Poultry live-bird revenue | 410300 | 40310 | Product-class mapping; eggs use the separate 40330 target where applicable. |
| Snail live-animal revenue | 410100 | 40210 | Product-class mapping; processed snail products use 40220. |

## Implementation order

1. Use workbook account metadata as the single target account master; preserve posting/control/manual-journal/cost-centre flags exactly.
2. Add context-aware resolution for the rows marked as splits or shared controls; a bare role-to-code constant is insufficient for those rows.
3. Update onboarding, reports, account-bearing settings, payroll, bank, tax, procurement, biological-asset, fixed-asset, production, and cutover paths together. Honor workbook control-account flags: allow only approved subledger workflows to post to controls, and keep direct journals prohibited. Keep the legacy chart available until cutover.
4. Add preflight validation that reports any active configuration or posting rule that still resolves only to a six-digit target or to an unresolved candidate.
5. Finance approves this crosswalk and the entity-level balance schedules before the cutover can post migration journals.

## Completed groundwork

The controlled posting services for bank accounts, payroll liabilities, fixed assets, asset impairment/accumulated depreciation, and year-end retained earnings now accept an active GL control account where appropriate. Expense accounts still require posting accounts. The central dimension/posting policy continues to disallow direct control-account journals. This prepares the runtime validation for the workbook's `Control Account=Yes`, `Posting Account=No` accounts; it does not change chart selection or account numbers yet.
