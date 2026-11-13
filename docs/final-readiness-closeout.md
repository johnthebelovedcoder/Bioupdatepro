# BioAssetPro final readiness closeout

**Purpose:** a gated plan to move from the current code state to a finance-approved, operationally ready pilot. This is a plan and evidence register; it does not authorize database posting, migration, or deployment.

## Current readiness

> **Latest local verification — 2026-11-12 (not CI).** Workspace production
> builds, workspace TypeScript checks, the database-package typecheck and
> Prisma schema validation, and the API boot check passed in the preceding
> verification. API unit tests passed
> 120/120 across 46/46 files. The full integration suite then passed 622/622
> tests across 61/61 files in 40m30.91s (217 Vitest suites, zero failures).
> Earlier long-run setup timeouts in `masters.spec.ts` and `posting.spec.ts`
> were followed by a clean full-suite run after the test-database reset and
> checkpoint adjustments; they are not failures in this latest run. UAT was
> rescored at 2026-11-12 13:21 WAT: 25 PASS and 1 PASS + MANUAL of 26, with
> both unit and integration evidence marked PASS. The passing local run uses
> uncommitted changes not present in `574f4b0` on `origin/main`. No CI result
> or production readiness sign-off is implied. The chart migration and
> Finance approval of the account-level crosswalk remain open.

> **Subsequent code change — 2026-11-13.** Employee bank, tax and identity
> values are now stored in plaintext by request; the `PII_ENCRYPTION_KEY`
> requirement was removed. Masking and reveal auditing remain application
> controls only. This change is local and has not been committed or deployed.

> **Superseded in part, 2026-10-31.** The bullets below were written on
> 2 October and several are no longer true. Corrected against commit
> `6839448`:
>
> - **The suite is green.** Unit 118/118, integration 620/620 across 61 files,
>   in 11 minutes. The "520 passing and 9 failing" and "54/54 unit" figures
>   below are superseded, as is the 50-minute run time behind the 90-minute CI
>   timeout.
> - **Provisioning is on the approved five-digit chart.** `ProvisionChart`
>   defaults to `'APPROVED'`, and posting-control provisioning marks the
>   superseded chart inert for a company already on it. The statements below
>   that the application "still provisions and posts against six-digit SPEC
>   codes" no longer hold.
> - **Migrations `0037–0045` are applied.** The live database reports `0053`.
>   That schema gap is closed. The balance-cutover rehearsal on an isolated
>   staging copy is a separate step and was not done.
> - **Nothing is unpushed.** Everything described here is merged to `main`.
> - **Requirement traceability now exists** for handbook §11: see
>   [frs-traceability.md](frs-traceability.md).
>
> As recorded on 2026-10-31, Finance had not signed the account-level
> crosswalk, the UAT and data-classification work in Gates 2, 3 and 5 was
> outstanding, and the database credential in action-register item 1 had not
> been rotated. At that date `PII_ENCRYPTION_KEY` was unset and MFA enforcement
> was off. Subsequent code changes now fail closed on missing PII encryption
> configuration and require MFA for privileged roles; deployment configuration
> and end-to-end verification remain open. The release decision below was
> awaiting Finance and client sponsor approval.

**Historical closeout notes (status recorded through 2026-10-31; not a current
verification):**

**Reconciled 2026-11-12.** Where the notes and gates below say the full
integration run is not green, or that the new-company chart test still fails
because active five-digit posting accounts sit beside a six-digit target
chart, that is the 2 October result. The latest local suite on 12 November
passed 120/120 unit tests and 622/622 integration tests across 61 files. Those
sentences are not the current software-test status. They do not close the
chart cutover: Finance has not approved the account-level crosswalk, companies
already posting on an older chart have not been migrated, and that migration
and its balance reconciliation have not been rehearsed on an isolated staging
copy. CI has not run on the revision that produced the 12 November result.

- Baseline application changes through commit `82ece7a` are pushed to `origin/main`; the current closeout changes in the working tree have not been pushed. This described the tree on 2 October. On 12 November, `origin/main` is `574f4b0`. The passing integration run also uses uncommitted fixture changes that are not in that commit.
- API source and test TypeScript checks pass. Focused integration suites on the disposable local PostgreSQL database passed 11/11 snail UAT, poultry UAT, and feed-mill standard-costing tests. Subsequent focused reruns also passed the journal-number format, finance soft-close restriction, approved posting-engine provisioning count, sales receipt validation, variance proration, and relative-sales-value/by-product-NRV cases. The indirect cash-flow bridge includes viable egg balances and removes biological/produce gains presented as other income.
- On 2 October the CI job timeout was set to 90 minutes because a full local integration run took about 50 minutes. CI had not run on that working tree. The "one confirmed COA failure" in that note is the 2 October chart-test result in the next bullet. It is not the 12 November local result. CI on the current release candidate is still unrecorded.
- **2 October record, superseded for the software suite.** The complete API integration run applied migrations `0000–0045` and all 18 constraint scripts, then reported **520 passing and 9 failing tests across 45 files**. Targeted reruns cleared eight failure causes: stale assertions for JV numbering, sales-value joint costing, finance posting into a soft close, and account provisioning, plus sales and standard-costing hook timeouts that did not recur in isolation. The remaining failure that day was the new-company chart test, which found active 5-digit posting accounts alongside the then-intended six-digit target chart. That test failure is closed in the local suite: the latest 12 November run passed 622/622. The underlying account-level crosswalk still needs Finance approval, and historical balances have not been migrated.
- The snail joint-cost case recognizes shell at NRV (178.092 kg × ₦2,500 = ₦445,230) and allocates the residual of the ₦19,148,000 pool (₦18,702,770) to meat. Its latest generated reconciliation report has 11 matching rows, five differences fully attributed to named causes, and zero unexplained differences. The poultry UAT replay also passes with named workbook differences.
- The API unit suite passed (54/54) in the 2 October closeout pass. Web TypeScript checking passed and the Next.js production build completed successfully that day. The later local unit result is 118/118. A complete CI run has still not been recorded for the 12 November release candidate.
- The payroll case was rebased to the agreed statutory settings and now passes: ₦4,250 monthly NHF on the ₦170,000 applicable base and ₦9,823 PAYE per employee, with final monthly PAYE rounded to the nearest naira. These figures supersede the old workbook check values for this UAT scenario.
- The live Neon database is still on legacy chart version and has migrations recorded only through `0036`; `0037–0045` are pending.
- The 2 October 2026 read-only reconciliation found no unbalanced posted journals, but material subledger, valuation, bank, and cutover exceptions remain. See [ledger-reconciliation-workpaper-2026-10-02.md](ledger-reconciliation-workpaper-2026-10-02.md).
- The user selected the five-digit chart in `YIFRE_Posting_Engine_Final_Implementation_Ready_01102026.xlsx` as the engineering target. On 2 October this was still an implementation gap: `chart.ts` and `recommended-coa.json` defined the app's SPEC chart with six-digit codes while provisioning also loaded the workbook's five-digit accounts. New-company provisioning has since moved to the approved five-digit chart, as recorded in [target-coa-decision.md](target-coa-decision.md). Finance must still approve the account-level crosswalk and any evidence-based split of historical balances. That approval, and the staging rehearsal of the cutover, remain open.
- The application-role analysis is recorded in [target-coa-role-crosswalk.md](target-coa-role-crosswalk.md). Direct control-account candidates are separated from roles needing item, fixed-asset, livestock-stage, cost-centre, or transaction-level resolution. This is a mapping workpaper, not approved configuration and not a migration source.
- As groundwork for the workbook's control-account flags, bank, payroll-liability, fixed-asset, impairment/accumulated-depreciation, and year-end retained-earnings validations now allow active control accounts for their controlled module workflows. Expense targets still require posting accounts, and direct journals remain blocked from control accounts. The actual target account-number cutover is still outstanding.
- The CFO API route for the superseded six-digit balance cutover is disabled. New-company signup loads posting controls without automatically switching the company to that chart. Posting-control status reports missing workbook accounts, account-metadata mismatches, unresolved active posting-map links, and active accounts outside the target; the ledger chart page presents that readiness instead of the old cutover form. Five-digit posting for a new company is implemented after this note; the historical-balance cutover still requires Finance approval and a staging rehearsal. The payroll and rearing-cost contract gap was true at this historical snapshot; standard event flows are now implemented in code. Finance still validates current statutory configuration and mappings. See [target-coa-decision.md](target-coa-decision.md).
- API (including API test TypeScript) and web TypeScript checks passed on the working tree after the control-account and chart-readiness changes. Integration tests and CI had not been run against that tree. The local integration suite has since passed; CI has not.
- After the chart-route and registration changes then in progress, API and web TypeScript checks passed and both production builds completed. No integration tests were run in that pass.
- At this historical snapshot, the workbook gap register reported one Partial MFA item. The current register records MFA as enforced in code; deployment key configuration and end-to-end privileged-role verification remain open. CI on the final commit is still unrecorded.
- This closeout does not certify the full client handbook/workbook line by line. Keep the current register as the implementation baseline and close its evidence gap as part of Gate 1.

## Ordered closeout gates

### Gate 1 — Freeze and prove the release candidate

**Owners:** Engineering; Finance Systems.

- Confirm the deployed revision against the release candidate and record environment, database target, and deployment revision without exposing credentials. `origin/main` is `574f4b0`. The 12 November passing integration run also depends on uncommitted fixture changes in `apps/api/test/global-setup.ts`, `apps/api/test/helpers/test-db.ts`, and `apps/api/vitest.config.ts`. Those changes are not on `origin/main`, so a CI run of the current remote commit would not be the revision that passed locally.
- Run the repository CI workflow on the commit that contains that fixture revision. Capture build, typecheck, database-package typecheck and Prisma validation, unit, integration, UAT, and web results and save the job link. The workflow now includes an explicit database package/schema check; it does not run `restore:check`, which requires a separate authorized restored branch. Latest local evidence, not CI: workspace production builds and TypeScript checks, database-package typecheck and Prisma schema validation, and API boot check passed; unit 120/120 across 46 files; integration 622/622 across 61 files in 40m30.91s; UAT 25 PASS and 1 PASS + MANUAL (both unit and integration PASS). The 2 October count of 9 integration failures, including the new-company chart mismatch, is historical. A green local suite does not establish historical five-digit balance migration or Finance approval.
- Review the client Acceptance_v2, Acceptance_Criteria, Costing_Policy_v2, STANDARD_COST_CHECKS, SYSTEM_INTEGRITY_MATRIX, handbook phases, and workbook checks row by row. Update the control-gap register with requirement ID, shipped code path, passing test/evidence, deployment status, owner, and exception. Verify production encryption-key configuration and the full MFA setup, sign-in, and recovery flow; MFA risk acceptance is not a substitute for the standard control.
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

- The workbook's five-digit chart is the engineering target (see [target COA decision](target-coa-decision.md)). New-company provisioning now uses that chart. The 2 October mixed-format test failure is closed in the local suite and does not block the software-test gate. What remains is the historical cutover: Finance must approve the account-level crosswalk and any evidence-based splits before balances move. Do not infer mappings by padding or truncating codes, and do not deactivate accounts based only on length. Standard payroll statutory accrual/payment and rearing-cost relief event flows are implemented in code; Finance must validate the applicable statutory configuration and target mappings. The cutover refuses to run until a named approval and reference are supplied.
- Finance signs the approved COA and the entity-specific legacy-to-approved crosswalk, including mapping of duplicate payables, payroll liabilities, inventory, biological assets, WIP, recovery, fixed assets, retained earnings, and P&L. Split balances only from supported subsidiary-ledger evidence.
- Reconcile and sign the pre-migration trial balance to the final close pack. Freeze the cutover date and prohibit backdated posting after the freeze except approved adjustments.
- Confirm which database is production and which is UAT, and verify a restorable backup before any cleanup or migration. Schema migrations `0037–0045` were already reported on the live database by 31 October 2026 (revision `0053`). Later migrations, including `0063_snail_egg_cost_source`, were recorded on 10 November 2026 as not yet applied to any database. On an isolated staging copy — not the shared or production database — apply any still-unapplied migrations, restore from the verified backup, and confirm schema, seeds, roles, account mappings, and controls.
- After Finance approval, run the chart cutover on that staging copy and compare the pre/post trial balance by entity, account, cost centre, and opening-equity bridge. Require zero unexplained difference. Do not run the cutover against production from this closeout.
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

**Not ready for historical balance migration or final pilot sign-off.** GitHub Actions run [#153](https://github.com/johnthebelovedcoder/Bioupdatepro/actions/runs/43030633903) passed on `main` commit `574f4b0` on 11 November 2026, including typecheck, API build/boot, unit, PostgreSQL integration, UAT evidence, and web build. It predates both the current working-tree changes and the newly added CI database-package/schema check. Latest local checks on this tree include API/web typechecks and builds, database-package typecheck and Prisma schema validation, API boot, unit 120/120, integration 622/622 across 61 files (40m30.91s), and UAT 25 PASS plus 1 PASS + MANUAL. The full local integration run completed without failures; the earlier setup-timeout runs are superseded. No CI run yet proves this exact working tree, and the result depends on uncommitted changes. New companies provision onto the approved five-digit chart. That is not pilot readiness.

Still open:

- CI run #153 is green on `574f4b0`, but does not include this working tree. The latest full local suite now passes; before calling this the release candidate, commit the intended changes and capture CI build, typecheck, unit, integration, UAT, and web-build evidence on that exact commit. The workflow currently does not run `restore:check`; that check requires a restored database branch and remains a separate restore-drill gate, not a local test against production.
- The historical five-digit cutover is not approved or rehearsed. Finance has not signed the account-level crosswalk. Standard payroll and rearing-cost posting flows are implemented in code; keep statutory rates and chart mappings current and have Finance validate them against applicable law and the approved chart. Rehearse the migration and balance reconciliation on an isolated staging copy before any production change.
- Production data is not closed: confirm which database is production versus UAT, verify a restorable backup, classify suspected test records, and reconcile inventory, biological assets, fixed assets, bank, supplier, payroll, and the other balances in the reconciliation workpaper to source evidence.
- Deployment controls are not closed: rotate the previously exposed database credential; verify `MFA_ENCRYPTION_KEY` and the required privileged-role MFA flow and recovery in the target deployment. Employee PII is stored in plaintext; database and backup access must be strictly restricted, and backups encrypted.
- Operational sign-off is not complete: deploy migration `0064` and assign responsible supervisors to existing populations; confirm period reopen in the live application; run role-based UAT and training; and obtain signed Finance and client acceptance. The one PASS + MANUAL UAT result is still outstanding.

Proceed gate by gate. Do not migrate balances with unresolved evidence, an unapproved crosswalk, or an unrehearsed cutover.

## Immediate action register

| Priority | Owner | Required action | Completion evidence |
|---|---|---|---|
| 1 | Database administrator + Engineering | Rotate the live database credential previously shared in the conversation; replace it in approved secret storage/runtime configuration and verify the old credential no longer works. | Rotation record and successful service connection using the new secret; no secret value in source or logs. |
| 2 | Finance Controller/CFO | Review and approve the account-level source crosswalk to the selected five-digit workbook chart, including evidence-based split mappings. | Signed, dated crosswalk; all split balances tied to item, asset, cohort, or transaction schedules. |
| 3 | Operations + Finance | Classify labelled test/UAT records and obtain the inventory, biological, fixed-asset, bank, and supplier source evidence listed in the reconciliation workpaper. | Signed classification and reconciliations with no unexplained material balances. |
| 4 | Engineering | Commit the intended fixture and product changes, then run CI on that commit. Capture build, typecheck, database-package/schema, unit, integration, UAT, and web-build results. Run `restore:check` against an isolated restored database branch. | CI run link on the release-candidate commit; restore-drill output. CI run #153 on `574f4b0` is green but predates this working tree and the new database-package/schema CI step. Latest 12 November local evidence: database-package typecheck and Prisma validation, unit 120/120, integration 622/622, UAT 25 PASS and 1 PASS + MANUAL; local results are not a substitute for CI on the exact commit. |
| 5 | Database Engineering + Finance | After the crosswalk is approved, rehearse unapplied migrations and the balance cutover on an isolated staging copy. Confirm production versus UAT and a restorable backup first. Do not treat migrations `0037–0045` as the remaining gap; the live database already reported `0053` on 31 October 2026. | Restore and rehearsal logs; pre/post trial balance with zero unexplained difference; Finance sign-off before production. |
| 6 | Client sponsor + operating owners | Complete role-based UAT, training, support/incident readiness, and authorize the pilot. | Signed UAT and pilot acceptance. |
