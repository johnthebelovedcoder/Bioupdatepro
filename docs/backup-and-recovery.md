# Backup and recovery

How BioAssetPro's data is backed up, how to restore it, and the drill that proves a restore works.

## Where the data is

- **Database:** Postgres on Neon (the `DATABASE_URL` set on the Render API service). It holds everything: the ledger, the records behind it, the audit trail and the close packs.
- **Encryption key:** `PII_ENCRYPTION_KEY` on the Render API service. Employee bank and statutory numbers are encrypted with it. **A restored database is unreadable for those fields without this key**, so keep a copy of the key somewhere other than Render, such as the company's password manager. Never keep it in the database or the repository.
- **Files:** the app keeps no files outside the database.

## How it is backed up

Neon keeps the database's write-ahead log and can restore to any moment inside the plan's history window. That makes a point-in-time restore possible to the second, with nothing to schedule.

- **Check the window.** It depends on the Neon plan. Look it up in the Neon console (Project settings, then Storage or History retention). Make sure it covers at least the time the business would take to notice a problem; seven days is a sensible minimum.
- **Off-site copy (recommended, client decision).** Take a nightly `pg_dump` to storage the company controls, kept for 35 days. That covers losing the Neon project itself. The dump contains employees' personal data (encrypted numbers, but names and addresses in the clear), so it needs the same care as the database.

## Recovery objectives (proposed, for the client to confirm)

| Objective | Target | Why it is achievable |
| --- | --- | --- |
| **RPO**: how much work can be lost | 5 minutes | Neon restores to any moment in its window; in practice the loss is seconds. |
| **RTO**: how long until the app is back | 1 hour | A restore branch is created in minutes. Pointing Render at it is one setting and a redeploy. |

## Restoring

1. **Stop further damage.** If bad data is still being written, suspend the Render API service.
2. **Pick the moment** just before the problem, in UTC. The audit trail (Ledger, then Audit) shows who did what and when.
3. **Create a branch from that moment** in the Neon console: Branches, then Create branch, from the production branch, with "Past point in time" at the chosen moment. Neon's `neonctl branches create --parent <prod> --parent-timestamp <time>` does the same from the command line.
4. **Check the branch before using it.** Run this from the repository, with the branch's connection string:

   ```bash
   RESTORE_CHECK_URL="postgresql://…branch…" npm run restore:check -w @bioassetpro/database
   ```

   It reads only. It confirms:
   - every migration is applied;
   - every protective trigger exists;
   - every journal balances, and each company's ledger balances;
   - every close pack still matches its fingerprint.

   It also prints the newest journal and audit entry, which is the recovery point actually reached. It exits 1 if anything fails.
5. **Switch over.** Either restore the production branch to the moment in the Neon console, or set Render's `DATABASE_URL` to the checked branch and redeploy. Keep `PII_ENCRYPTION_KEY` unchanged.
6. **Record the drill or incident** in the log below: when the problem happened, the moment restored to, how long each step took, and the check output.

## The drill

Run a restore drill at least twice a year and after any change to hosting.
1. Create a branch from a moment an hour ago (step 3 above).
2. Run the check against it (step 4).
3. Sign in to a preview pointed at the branch and open a posted journal and an employee record.
4. Record the result below, then delete the branch.

The drill never touches the production branch.

## Drill log

| Date | Who | Environment | Restored to | Time taken | Result |
| --- | --- | --- | --- | --- | --- |
| 2026-09-27 | Development (Claude, for Timi) | Local Postgres 17. The 500-poultry case replayed into a scratch database, then copied with `CREATE DATABASE … TEMPLATE`, standing in for a Neon branch. | Last journal 2026-09-27 08:38:59 UTC | Copy 1.4 s; check under 5 s | **PASS**: 32 of 32 migrations, 49 triggers, 39 journals all balanced, 1 company in balance. Dropping one trigger from the copy made the check fail, naming it. |
| | | Neon production, first real drill | | | *To do: needs someone with Neon console access.* |
