# Approved-chart cutover — rehearsal on a restored database, 4 October 2026

**Result: the cutover ran cleanly on both restored databases, after the rehearsal found and I fixed four faults. It has not yet been rehearsed on a copy of production.** Do that before the real run (steps at the end).

## What was rehearsed

No production data or Neon branch was available to me. I used the next best thing the repository has: the client's own 500-poultry and 500-snail workbook cases (UAT-022), each replayed through the application into its own database, then taken through a real `pg_dump` / `pg_restore` into a fresh database, and the cutover run on the restored copy. PostgreSQL 16.14, all 48 migrations applied from the migration files, `restore:check` run on each restore before and after.

| | Poultry case | Snail case |
|---|---|---|
| Journals / lines in the copy | 39 / 81 | 25 / 60 |
| Dump size, dump + restore time | 0.9 MB, 0.2 s + 1.4 s | 0.9 MB, 0.2 s + 1.4 s |
| `restore:check` before | PASS | PASS |
| Chart at start | six-digit (SPEC) | six-digit (SPEC) |
| Steps | close FY2026 (year end, 0.2 s), then cut over 1 Feb 2027 | same |
| Balances moved / journals | 17 / 1 | 18 / 1 |
| Settings repointed / old accounts retired | 136 / 88 | 139 / 88 |
| Cohorts restated | 1 (Broiler → 16042) | 0 |
| Run time (including loading the approved keys) | about 6 s | about 6 s |
| `restore:check` after | PASS (48/48 migrations, 49 triggers, 0 unbalanced journals, close pack intact) | PASS |

Checked after the run, against the same figures taken before it: the trial balance balances; total assets, liabilities and equity are identical (poultry ₦21,251,527.60 / ₦997,933.28 / ₦20,253,594.32 and snail ₦64,917,950.00 / ₦20,459,385.00 / ₦44,458,565.00); profit is identical; the segment report's six checks pass; the cash flow statement for the cutover month reconciles to the bank; control-account reconciliations are in the same state as before (the receivables and payables rows were already unreconciled in the case data and still are, by the same amounts); no active account and no configuration is left outside the approved chart.

The rehearsal is `apps/api/test/rehearsal/cutover-rehearsal.spec.ts` (`vitest.rehearsal.config.ts`), not part of `npm test`.

## What it found, and what I did

1. **Cash flow no longer reconciled in the cutover month (poultry: ₦497,705.52 out; snail: ₦4,070,000.00 out).** The statement's receivable, payable, tax, payroll and fixed-asset buckets listed the old accounts and only some approved ones (11000, 20100, 20300, 20600, 20700, 15xxx were missing), and the old snail biological asset accounts dropped out once their stage mappings moved. Fixed: the buckets now take every account on every chart, and the depreciation schedule knows the approved fixed-asset classes. Regression test added.
2. **Year-end close could not run on the approved chart at all.** Its closing and opening journals carry no dimensions, and nearly every approved expense, revenue and inventory-control account requires a cost centre, so the close was refused (the snail copy hit it on 42000; any real approved-chart company would). Fixed: those lines take the company's first usable cost centre, department or farm where the account requires one. New integration test. Separately, and not changed: year-end carries each account as one figure, so customer, supplier and item detail on balances is not preserved across a year end; that is how it already worked.
3. **Stock lines with no item went to the wrong inventory control.** The snail copy's raw-material balance carried no item, so the cutover put it in 12000 while the stock ledger's items belong to packaging (12200), and 12200 then failed its subledger tie-out. Fixed: such lines are shared by the stock ledger's value of each item type, so each control ties to its own items. The item types are still guessed from names (feed flag, "carton", "sack"…) and are shown in the preview to be checked.
4. **A poultry balance with no pen was assumed immature although the only cohort is mature**, because the cohort had been harvested (no cost, no head count) and was ignored. Fixed: with nothing else to weight by, the stage of the cohorts present decides.

## What this rehearsal did not cover

- **A copy of production.** Row counts here are in the tens, not thousands; the run time and the preview's size at production volume are unknown. The plan reads each cohort and posts one journal line pair per balance and dimension set, so I expect it to scale with the number of distinct balances, not rows, but I have not measured it.
- **A four-digit (LEGACY) company and a mid-year cutover on case data.** The case databases are on the six-digit chart and carry October and December postings, so a mid-year cutover is correctly refused (13 lines on old accounts dated after the cutover date). Both paths, and the cutover moving income and expense accounts, are covered by the integration tests (`approved-cutover.spec.ts`) but not by a restore.
- **Finance's choices.** Impairment loss and the two capitalised-variance accounts have no approved account, so `unresolvedRoles` still lists them after the cutover (none held a balance here). The cutover refuses while any of them does.
- **Anything after the cutover** other than the statements above: I did not post new feed, sales or production documents against the restored copy.

## Rehearsing on production

1. In Neon, create a branch from a point just before the cutover date (`docs/backup-and-recovery.md`, step 3). Never run the rehearsal on the production branch.
2. `RESTORE_CHECK_URL=<branch> npm run restore:check -w @bioassetpro/database` (must pass).
3. Run the rehearsal against the branch (it runs the cutover, which changes the branch):
   `cd apps/api && DATABASE_URL=<branch> REHEARSAL_NAME=prod REHEARSAL_CUTOVER=<first day of the cutover month> npx vitest run --config vitest.rehearsal.config.ts`
   Add `REHEARSAL_OPTIONS='{"overrides":{…},"itemClasses":{…}}'` for the choices Finance makes. If it reports BLOCKED, `test/rehearsal/out/<name>.json` holds the preview with the blockers.
4. Read the preview's assumptions with Finance, then record the result in the log below and delete the branch.

## Drill log

| Date | Who | Environment | Result |
|---|---|---|---|
| 2026-10-04 | Development (Claude, for Timi) | Postgres 16.14; 500-poultry and 500-snail case databases, `pg_dump`/`pg_restore` into fresh databases | **PASS** after four fixes (above) |
