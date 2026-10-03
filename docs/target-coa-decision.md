# Target COA decision — 2 October 2026

## Decision

The five-digit chart in `YIFRE_Posting_Engine_Final_Implementation_Ready_01102026.xlsx` is the engineering target. This follows the user's direction on 2 October 2026 to proceed with the recommendation to use the workbook identified in the repository as the approved posting-engine source.

This is an engineering target selection. It is **not** Finance approval of account classifications, mappings, opening balances, or migration. The existing `approved-coa-crosswalk-review.csv` is explicitly a standards-based recommendation: all 68 rows still have blank Finance-approved target codes and no Finance review status.

## Why code migration is not a simple code-length change

- The workbook defines 134 five-digit accounts and also supplies posting-account, control-account, manual-journal, normal-balance, and cost-centre metadata. Provisioning must honor those attributes rather than create every account as an active posting account.
- The application chart roles currently refer to six-digit target accounts. Some correspond to a single workbook account, but others require a subledger-driven choice or split. Examples include raw material versus feed inventory, PPE and accumulated depreciation by asset class, livestock by species and maturity, harvested eggs versus viable eggs, and payroll/levy liabilities by beneficiary and nature.
- The existing chart-unification process moves four-digit legacy balances to six-digit codes. Moving it to five-digit targets changes its account map, journal descriptions, post-cutover checks, configuration repointing, account lifecycle rules, and test expectations.
- Workbook account-map and posting-key references must resolve to actual five-digit GL account IDs while keeping dynamic service-resolved postings dimensioned correctly.

The role-by-role findings are in [target-coa-role-crosswalk.md](target-coa-role-crosswalk.md). It records safe direct candidates separately from mappings that depend on item class, asset class, livestock stage, cost centre, tax/liability nature, or transaction source.

## Implementation and release gates

1. Make the five-digit workbook the only active target chart for new-company provisioning; retain legacy history and compatibility for existing companies until their approved cutover.
2. Generate target accounts from the workbook's complete account metadata and make account-map/posting-key resolution use those five-digit records.
3. Update chart-role resolution and posting services to use approved workbook accounts. Where role mapping depends on an item, asset, biological stage, or liability nature, use existing subledger dimensions or stop and surface a cutover exception; do not guess.
4. Update the legacy cutover preview to list and block unresolved split balances. Preserve balanced, linked journals and repoint all account-bearing settings before retiring legacy codes.
5. Pass integration, UAT, and migration-rehearsal checks on a disposable/staging database. Do not apply schema or balance migrations to shared/production Neon during this work.
6. Obtain Finance sign-off on the account-level crosswalk and reconciled opening balances before historical balance migration.

## Known blockers

- The crosswalk has 68 proposed rows and zero Finance-approved targets. Split rows require transaction/item/asset/cohort evidence.
- The read-only ledger workpaper dated 2 October 2026 identifies material open inventory, biological-asset, production/recovery, fixed-asset, payroll/AP, and bank reconciliations.
- The new-company integration test now asserts that a company remains on its provisioned chart and records the mixed legacy/six-digit compatibility configuration. This corrects the stale expectation; it does not prove five-digit posting readiness.
- The current working tree has not been run through CI; the latest full API integration run had one confirmed chart-source failure.

## Implemented transition safeguards

- Bank, payroll liability, fixed asset, accumulated depreciation/impairment, and year-end retained earnings flows now accept an active workbook control account through their dedicated module workflow. Direct journals remain blocked by the posting/dimension policy.
- New-company registration provisions posting controls but no longer automatically moves a farm into the superseded six-digit chart.
- The CFO route for the old six-digit balance cutover now returns a conflict, and the old six-digit cutover form has been replaced with the live five-digit chart readiness page.
- Posting-control status now checks target-account presence, workbook metadata, active mapping links, and active accounts outside the approved target.
- The chart-unification integration test now asserts the current guarded onboarding behavior and explicitly exposes the six-digit GRNI compatibility account. The test has passed TypeScript checking but has not yet been run against the integration database.
- `chart.ts` has a third chart version, `APPROVED`, with the five-digit number for every role the crosswalk resolves directly (bank, receivables, feed and packaging inventory, VAT/WHT, payroll and PAYE control, GRNI, trade payables, retained earnings, depreciation expense, and per-species mortality loss, live cost of sales and live revenue). Each number is taken from the workbook's own account maps for the company-wide application (YifrehCore) and checked against them by test. Raw materials, fixed assets (cost 15200, accumulated depreciation 15600), employer NSITF/ITF (accrued expenses control 20200) and payroll and operating expense follow those maps. Impairment loss and the two POL-009 capitalised variances have no workbook account, so they raise `UnresolvedApprovedAccount` instead of guessing. Posting-control status now lists those roles, and any role whose account is missing from the company's chart, under Books → Controls. `test/unit/chart-approved.spec.ts` checks every mapped number against the workbook's account master. No company is on `APPROVED`; the cutover is still disabled.

- Poultry rearing cost on the approved chart is held by the flock's stage on the day each feed, treatment or labour share is posted: 16032 immature, 16042 mature (decision of 3 October 2026). `POULTRY_STAGE_MATURITY` in `chart.ts` classifies the stage names (Chick, Grower, Pullet, Cockerel immature; Market-ready, Point-of-lay, Layer, Broiler, Breeder mature); the workbook names the two accounts but not the stages, so Finance must confirm it, and a stage not listed is refused. Each posting records its account; a death, sale, transfer or harvest takes its share from every account in proportion to what each holds (largest remainder, never over-drawing one), and a valuation moves cost held in the other stage's account into the account fair value sits in, so no stage account is stranded. Snail feed, treatment and farm labour are expensed to 52610, 52510 and 52010. Migration `0046` adds the per-posting account and the relief split rows. `test/integration/rearing-cost-approved.spec.ts` runs a flock through feed in two stages, death, sale, last birds out, transfer and valuation, and checks every stage account clears to exactly zero.

- Poultry eggs on the approved chart (`eggAccountsFor` in `chart.ts`): collected into 12420 (finished poultry products, the workbook's PLP-FG-EGG) against the 42000 gain, sold to 40330 revenue and 50330 cost of sales (an egg item with none of its own takes those when its value is set), and chicks hatched into the stage account for 'Chick' (16032, the workbook's immature poultry map); a hatch with nothing hatched is written off to 51120. The workbook has no account for eggs held in incubation: 13020 (poultry farm WIP control) is an engineering proposal for Finance to confirm. `test/integration/egg-approved.spec.ts` runs collect, set, hatch and a failed hatch.

Still on the old six-digit compatibility accounts, so a company cannot yet be moved onto the approved chart: the fair-value gain and loss account for valuations (420200/420100 against the workbook's 42000/42100), the production and processing posting rules, snail biological asset stages, and reporting that reads 1501, 130400 and the other old numbers (the cash-flow bridge knows 12420 and 13020 only). A harvest into processing on the approved chart is built but has no test of its own.

The five-digit posting-role mappings and balance cutover are not complete. The readiness page is expected to remain blocked until the application mapping is aligned and existing balances are reconciled.
