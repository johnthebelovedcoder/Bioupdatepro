# BioAssetPro final readiness closeout

**Purpose:** a gated plan to move from the current code state to a finance-approved, operationally ready pilot. This is a plan and evidence register; it does not authorize database posting, migration, or deployment.

## Current readiness

- Baseline application changes through commit `82ece7a` are pushed to `origin/main`; the current closeout changes in the working tree have not been pushed.
- API source and test TypeScript checks pass. Focused integration suites on the disposable local PostgreSQL database passed 11/11 snail UAT, poultry UAT, and feed-mill standard-costing tests. Subsequent focused reruns also passed the journal-number format, finance soft-close restriction, approved posting-engine provisioning count, sales receipt validation, variance proration, and relative-sales-value/by-product-NRV cases. The indirect cash-flow bridge includes viable egg balances and removes biological/produce gains presented as other income.
- The CI job timeout is now 90 minutes because the latest full local integration run took about 50 minutes. CI has not yet run on this working tree; the latest full run still has one confirmed COA failure. The local change gives CI enough time to report the complete suite result.
- The complete API integration run on 2 October applied migrations `0000–0045` and all 18 constraint scripts, then reported **520 passing and 9 failing tests across 45 files**. Targeted reruns cleared eight failure causes: stale assertions for JV numbering, sales-value joint costing, finance posting into a soft close, and account provisioning, plus sales and standard-costing hook timeouts that did not recur in isolation. One real failure remains: the new-company chart test finds active 5-digit posting accounts alongside the intended six-digit target chart. This exposes a mismatch between COA sources and blocks a clean release-wide result.
- The snail joint-cost case recognizes shell at NRV (178.092 kg × ₦2,500 = ₦445,230) and allocates the residual of the ₦19,148,000 pool (₦18,702,770) to meat. Its latest generated reconciliation report has 11 matching rows, five differences fully attributed to named causes, and zero unexplained differences. The poultry UAT replay also passes with named workbook differences.
- The API unit suite passed (54/54) in the preceding closeout pass. Web TypeScript checking passes and Next.js production build completed successfully on 2 October. A complete final CI run has not been recorded for the current working tree.
- The payroll case was rebased to the agreed statutory settings and now passes: ₦4,250 monthly NHF on the ₦170,000 applicable base and ₦9,823 PAYE per employee, with final monthly PAYE rounded to the nearest naira. These figures supersede the old workbook check values for this UAT scenario.
- The live Neon database is still on legacy chart version and has migrations recorded only through `0036`; `0037–0045` are pending.
- The 2 October 2026 read-only reconciliation found no unbalanced posted journals, but material subledger, valuation, bank, and cutover exceptions remain. See [ledger-reconciliation-workpaper-2026-10-02.md](ledger-reconciliation-workpaper-2026-10-02.md).
- The user has selected the five-digit chart in `YIFRE_Posting_Engine_Final_Implementation_Ready_01102026.xlsx` as the engineering target. The chart failure is now an implementation/crosswalk gap: `chart.ts` and `recommended-coa.json` still define the app's SPEC chart with six-digit codes; provisioning loads the approved workbook's 134 five-digit accounts, 221 five-digit account-map references, and 67 posting-account rows too. SPEC chart loading only creates six-digit accounts, while chart unification retires the known four-digit legacy list. Engineering must align the target chart and mapping behavior; Finance must still approve the account-level crosswalk and split balances.
- The application-role analysis is recorded in [target-coa-role-crosswalk.md](target-coa-role-crosswalk.md). Direct control-account candidates are separated from roles needing item, fixed-asset, livestock-stage, cost-centre, or transaction-level resolution. This is a mapping workpaper, not approved configuration and not a migration source.
- As groundwork for the workbook's control-account flags, bank, payroll-liability, fixed-asset, impairment/accumulated-depreciation, and year-end retained-earnings validations now allow active control accounts for their controlled module workflows. Expense targets still require posting accounts, and direct journals remain blocked from control accounts. The actual target account-number cutover is still outstanding.
- The CFO API route for the superseded six-digit balance cutover is disabled. New-company signup now loads posting controls without automatically switching the company to that chart. Posting-control status reports missing workbook accounts, account-metadata mismatches, unresolved active posting-map links, and active accounts outside the target; the ledger chart page now presents that readiness instead of offering the old cutover form. The five-digit posting-role mappings and migration journal logic remain outstanding.
- API (including API test TypeScript) and web TypeScript checks pass on the current working tree after the control-account and chart-readiness changes. Integration tests and CI have not been run against this latest working tree.
- After the latest chart-route and registration changes, API and web TypeScript checks pass and both production builds complete successfully. No integration tests were run in this pass.
- The client workbook gap register reports 63 Built, 23 Built 26 Sep, one Partial (multi-factor sign-in), and zero Not built. Those statuses rely on cited automated tests that still need a clean run against the final commit.
- This closeout does not certify the full client handbook/workbook line by line. Keep the current register as the implementation baseline and close its evidence gap as part of Gate 1.

## Ordered closeout gates

### Gate 1 — Freeze and prove the release candidate

**Owners:** Engineering; Finance Systems.

- Confirm the deployed/local revision and record environment, database target, and deployment revision without exposing credentials. The baseline pushed revision is `82ece7a`; the current closeout changes remain unpushed.
- Run the repository CI workflow and the API unit, complete integration, workbook UAT, web, and database checks on the final release commit. Save the job links/results and resolve failures. The full API run had 9 failures; eight targeted causes have since passed focused reruns. The remaining new-company COA mismatch exposed stale test expectations and mixed legacy/six-digit compatibility configuration; the test is updated to assert the guarded onboarding state, but still needs an integration run. This does not establish five-digit posting readiness.
- Review the client Acceptance_v2, Acceptance_Criteria, Costing_Policy_v2, STANDARD_COST_CHECKS, SYSTEM_INTEGRITY_MATRIX, handbook phases, and workbook checks row by row. Update the control-gap register with requirement ID, shipped code path, passing test/evidence, deployment status, owner, and exception. Resolve the Partial MFA item: implement MFA or record a signed pilot risk acceptance and compensating control.
- Verify the 14 agreed accounting decisions against current screens, APIs, seed/config values, and posting rules: FVLCTS and mortality, relative-sales-value split-off allocation, by-product NRV/immaterial policy, viable snail eggs, source-driven feed-mill actuals, one dimensioned recovery account, configurable ₦6,500 UAT bird rate, NGN pilot, approved COA and cost centres, approval limits, payroll rules, soft-close authorities, annual journal numbers/reversals, and Phase 6 wording.

**Exit evidence:** approved traceability matrix with no unowned requirement; all release checks green or formally accepted exceptions; signed pilot scope and entity list.

### Gate 2 — Classify production/UAT data and obtain source evidence

**Owners:** Operations; Stores; Livestock/Production; Finance; IT.

- Confirm whether the configured Neon database is production, UAT, or a shared mixed environment. Take and verify a restorable backup before any cleanup.
- Operations classifies every record labelled `TEST`, `VERIFY`, `LOSS`, `NEG`, `verify-script`, or otherwise synthetic as **operational**, **UAT**, or **unresolved**. The current workpaper identifies 67 labelled posted journals, 18 explicitly labelled production orders, 78 unlinked setup receipts, eight explicitly named test assets, plus unlabelled/open orders needing a decision. Source labels are candidates, not authority to reverse.
- Obtain signed stock counts by item, warehouse, lot/batch, and biological cohort; reconcile movement-level receipts/issues/transfers/write-offs and record explanations for unlinked movements.
- Obtain reporting-date biological population counts and market-price/cost-to-sell evidence by active cohort. Finance documents any IAS 41 cost exception, reliability rationale, carrying amount, and review date. Resolve TIMIFA unmapped/unvalued poultry cohorts.
- Obtain asset register, supplier invoice/GRN, in-service date, useful life, depreciation, disposal, and impairment support for every live fixed asset.
- Obtain bank statements and bank ownership/account mapping for the closing date; establish the bank account master and reconcile GL cash to bank. The current BAP workspace has no bank master/statements.
- Obtain supplier statements, remittance/payment references, payroll remittance support, and GRN-to-invoice schedules for all balances.

**Exit evidence:** each scoped record has an owner, source document, classification, count/valuation, tie-out, and signed disposition; no unresolved UAT record affects the proposed opening balance.

### Gate 3 — Approve and post accounting corrections under control

**Owners:** GL/Financial Accountant prepares; Finance Manager/FC approves and posts; CFO authorizes reopening or exceptions.

- Build a journal-by-journal correction schedule from Gate 2 evidence. Separate true UAT contamination, duplicate/incorrect mapping, timing items, missing source links, and genuine balances.
- Reconcile BAP trade-payable and payroll/accrual postings, inventory, BA stages, production WIP/recovery, fixed assets/depreciation, and all bank and tax/payroll liabilities. Keep the ₦240,000 GRNI schedule and other already-tied items in the evidence pack.
- Prepare linked reversals/reclassifications with new numbers, cost centres, source references, preparer and independent approver. Do not delete/overwrite posted journals. Administrators do not post.
- Correct subledger-only UAT stock records through an approved, auditable cleanup route and confirm that stock counts and GL values still agree afterward.
- Rerun the period-close and control-account reconciliation reports. Investigate every variance; no plug journals.

**Exit evidence:** signed reconciliation schedule; every GL control account equals its subledger; every journal is balanced; all material variances cleared or explicitly accepted under policy; cutoff and subsequent-event journals reviewed.

### Gate 4 — Approve target COA and migrate schema safely

**Owners:** Finance Controller/CFO; Database Engineering.

- The user selected the workbook's five-digit chart as the engineering target (see [target COA decision](target-coa-decision.md)). The workbook has 134 five-digit account rows, 221 five-digit account-map references, and 67 posting-account rows. `recommended-coa.json`, `chart.ts`, and unification still use the app's six-digit SPEC chart; provisioning currently loads both, and unification retires the four-digit legacy list only. Align provisioning, account metadata, dynamic mappings, role-account resolution, unification, settings, and tests to the selected five-digit chart. Finance must approve the account-level crosswalk and evidence-based splits before migration. Do not infer mappings by padding/truncating codes or deactivate accounts based only on length. The mixed-format test failure remains and blocks release-wide green status.
- Finance signs the approved COA and the entity-specific legacy-to-approved crosswalk, including mapping of duplicate payables, payroll liabilities, inventory, biological assets, WIP, recovery, fixed assets, retained earnings, and P&L. Split balances only from supported subsidiary-ledger evidence.
- Reconcile and sign the pre-migration trial balance to the final close pack. Freeze the cutover date and prohibit backdated posting after the freeze except approved adjustments.
- In a restored staging clone, apply migrations `0037–0045`, then constraints; verify resulting schema, seeds, roles, account mappings, controls, and backup restore. Do not experiment on shared Neon.
- Run the approved COA provisioning/crosswalk on staging and compare pre/post trial balance by entity, account, cost centre, and opening-equity bridge. Require zero unexplained difference.
- Obtain a migration runbook, rollback/restore evidence, implementation window, named operator, and Finance sign-off. Then apply migrations to the intended production database under change control.

**Exit evidence:** signed crosswalk; staging rehearsal and restore passed; zero unexplained migration difference; production migration logs and post-migration validation approved.

### Gate 5 — Historical balances, UAT, and pilot sign-off

**Owners:** Finance; Operations; Engineering; client sponsor.

- Prepare opening subledgers and trial balance only from reconciled schedules. Import/post through the approved opening-balance path with entity, module, year/sequence number, effective date, cost centre, evidence reference, and preparer/approver controls.
- Prove opening trial balance debits equal credits and each control account agrees to its converted subledger. Validate retained earnings and comparative balances with Finance.
- Replay the client’s critical scenarios: biological monthly/pre-harvest valuation and mortality; eggs/hatching; poultry split-off and by-products; feed-mill actual-cost recovery; payroll and statutory deductions; approvals; period close/reopen; reversals and numbering; inventory traceability; and reports/cash flows.
- Run role-based UAT with the intended Finance Accountant, Manager/FC, CFO, Operations, and Administrator roles. Confirm least privilege, cost-centre enforcement, and maker-checker separation.
- Get signed client acceptance, training completion, backup/restore and incident contacts, support owner, monitoring, and cutover approval.

**Exit evidence:** passed signed UAT scripts; converted TB/subledgers reconcile; operational owners trained; client sponsor authorizes pilot start.

## Release decision

**Not ready for historical balance migration or final pilot sign-off today.** The five-digit workbook is selected as the engineering target, but the application still provisions and posts against six-digit SPEC codes and the full chart alignment is not implemented. The complete API run is not green, current changes are unpushed, live migrations `0037–0045` remain unapplied, client source evidence and UAT record classification are outstanding, ledger exceptions remain open, and Finance has not signed the account-level crosswalk or operational acceptance. Proceed gate by gate; do not migrate balances with unresolved evidence or unexplained ledger exceptions.

## Immediate action register

| Priority | Owner | Required action | Completion evidence |
|---|---|---|---|
| 1 | Database administrator + Engineering | Rotate the live database credential previously shared in the conversation; replace it in approved secret storage/runtime configuration and verify the old credential no longer works. | Rotation record and successful service connection using the new secret; no secret value in source or logs. |
| 2 | Finance Controller/CFO | Review and approve the account-level source crosswalk to the selected five-digit workbook chart, including evidence-based split mappings. | Signed, dated crosswalk; all split balances tied to item, asset, cohort, or transaction schedules. |
| 3 | Operations + Finance | Classify labelled test/UAT records and obtain the inventory, biological, fixed-asset, bank, and supplier source evidence listed in the reconciliation workpaper. | Signed classification and reconciliations with no unexplained material balances. |
| 4 | Engineering + Finance Systems | Implement the approved chart mapping/cutover behavior; run CI on the final candidate and resolve failures. | CI run link with typecheck, build, unit, integration, and UAT checks green or formally accepted exceptions. |
| 5 | Database Engineering + Finance | Rehearse migrations `0037–0045` and restore on an isolated staging clone after Gate 2/3 reconciliation and Gate 4 approval. | Restore and migration rehearsal logs; pre/post trial balance agrees with zero unexplained difference. |
| 6 | Client sponsor + operating owners | Complete role-based UAT, training, support/incident readiness, and authorize the pilot. | Signed UAT and pilot acceptance. |
