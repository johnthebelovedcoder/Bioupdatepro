# BioAssetPro

Farm management and accounting for Nigerian livestock farms — poultry and snails
today, built so fish, dairy, pigs, goats and rabbits are configuration rather
than new code.

## What makes it different

Most farm software records operations. Most accounting software records money.
Neither can answer the question a farmer actually asks: **did this batch make
money, and if not, where did it go?**

Answering that needs both halves and one source of truth between them. So feed
issued to a batch is not a note in a log — it is a posting that moves value out
of inventory and into that batch's work-in-progress account. The operational
record and the ledger are the same record, seen from two ends.

That is also what makes theft detectable. A house using 18% more feed per bird
than the identical house next door is a discrepancy no textbook can spot and no
farm can argue with, and it is only computable because the feed, the birds and
the money are in one system.

## Design rules

These hold throughout and are worth knowing before reading the code.

- **Money is integer kobo.** Never a float, never a Number over the wire —
  BigInt in the API, decimal strings in JSON. A rounding error in a ledger is
  not a rounding error, it is a discrepancy somebody has to explain.
- **Posted transactions are immutable.** Corrections are reversals. Enforced by
  database triggers, not convention.
- **The species lives in the data.** No poultry table, no snail enum. A batch of
  broilers and a colony of snails are the same row with a different
  `speciesKey`; the words on screen come from a module registry.
- **Nothing is invented.** Where the source documents are silent — statutory
  rates, approval limits, breed standards for species that have none published —
  the product says so rather than guessing. A benchmark of unknown origin beside
  a real figure is worse than no benchmark.
- **The interface is honest about what it cannot do.** Work recorded with no
  signal says it is queued, not saved. Figures that are illustrative say so.

## Architecture

```
apps/
  api/        NestJS. Ledger, tax, payroll, O2C, P2P, period close, operations.
  web/        Next.js App Router. Mobile-first; the daily round is the centre.
packages/
  database/   Prisma schema, seeds, SQL constraints and immutability triggers.
```

The web app writes through an **outbox**. Every submission is queued in the
browser with an idempotency key generated once and reused across retries, so a
handset that loses signal mid-send cannot record the same round twice. Reads
come from the API; anything still illustrative is labelled.

### Authorisation

Three guards answering three different questions. Being signed in satisfies
none of them on its own.

| Guard | Question | On failure |
|---|---|---|
| `CompanyScopeGuard` | May this request *name* this company? | 403 |
| `OwnedRecordGuard` | May it *touch* this record? | **404**, never 403 — a 403 would confirm the id exists and turn the endpoint into an oracle for enumerating another tenant's keys |
| `RolesGuard` | May this *role* reach this endpoint? | 403 naming the role required, never the role held |

`RolesGuard` **denies by default**. A route with no explicit `@Roles(...)`,
`@AnyRole(reason)` or `@Public` is refused — including for an administrator —
so a forgotten rule fails loudly the first time it is called instead of sitting
there as an accidental hole.

## Getting started

Requires Node 20+. No Docker: the development database is a real PostgreSQL
started by a script.

```bash
npm install
cp .env.example .env
```

Then set `JWT_SECRET` in `.env` — the API will not start without it:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Bring up the database and load it:

```bash
npm run db:start        # PostgreSQL on :5433
npm run db:migrate      # migrations + SQL constraints and triggers
npm run db:seed         # chart of accounts, tax codes, calendar
npm run db:seed:users   # one user per rung of the approval ladder
npm run db:seed:ops     # illustrative livestock and 30 days of history
npm run db:seed:trade   # customers, suppliers, feed and medication items
```

Run the two apps in separate terminals:

```bash
cd apps/api && npm run dev    # :3001
cd apps/web && npm run dev    # :3000
```

Sign in with any seeded user — password `admin123@`:

| Email | Role | Sees |
|---|---|---|
| `supervisor@bioassetpro.ng` | Production supervisor | Livestock and the daily round. No money. |
| `farm.manager@bioassetpro.ng` | Farm manager | The farm, buying, and money. Not the ledger. |
| `controller@bioassetpro.ng` | Financial controller | The ledger, journals, period close. |
| `cfo@bioassetpro.ng` | CFO | Everything, including tax, payroll and year-end close, and approvals. |
| `admin@bioassetpro.ng` | Administrator | Everything, including staff and invitations. |

Or create your own farm at `/signup` — registration provisions a chart of
accounts, cost centres and twelve open periods in one transaction, so a new
farm can record a round on its first morning. A new farm keeps its books on
the client's six-digit chart from the start.

## The two charts of accounts

Farms registered before 2026-09-25 started on a four-digit chart (`LEGACY`);
the client's posting rules are written against a six-digit one (`SPEC`).
`Company.chartVersion` says which a farm is on, and code asks for an account
by purpose through `apps/api/src/chart/chart.ts` rather than by number.

**Books → Controls → See the move** (`/ledger/chart`) moves a farm across. It
shows every old balance and where it will go before anything changes, then a
CFO runs it: one journal per branch dated the first day of an open month,
settings repointed, old accounts retired, all in one transaction. The mapping
and the decisions behind it are in `docs/chart-unification-mapping.csv`.

## Release evidence (UAT)

`npm run uat --workspace @bioassetpro/api` runs every suite and scores the
26 tests of the client's UAT_CONTROL_REGISTER against the automated tests that
evidence each one — its positive path and its negative/integrity test — in
`apps/api/test/uat/uat-report.md`. CI does the same on every push and fails
if any is missing or failing. UAT-026 additionally needs the observed test with
a farm worker, supervisor and finance user that UX_ACCEPTANCE requires.

The client's 500-snail case is replayed through the application
(`apps/api/test/integration/case-500-snail.spec.ts`) and compared with the
workbook's APP_EXPECTED_RESULTS in `apps/api/test/uat/case-500-report.md`: figures
either match or differ by named causes (the workbook's purchased breeders
vanishing from its books, its unposted opening stock, and so on); an
unexplained difference fails the test.

## Deploying schema changes

Change `schema.prisma`, then create a migration with
`npx prisma migrate dev --name <what-changed>` in `packages/database` against a
local database, review the SQL it wrote, and commit it. Deploys run
`npm run db:migrate`, which applies pending migrations in order. `db:push` is
for throwaway local databases only.

## Backups

A GitHub Action (`.github/workflows/backup.yml`) dumps the production
database every night at 02:00 UTC, encrypts it, proves it can be read back,
and keeps it for 30 days as a workflow artifact. It needs two repository
secrets: `BACKUP_DATABASE_URL` (Neon's direct connection string — the host
without `-pooler`) and `BACKUP_PASSPHRASE` (keep a copy outside GitHub; the
backups cannot be read without it).

To restore, download the artifact from the workflow run, then:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in bioassetpro-YYYY-MM-DD.dump.enc -out restore.dump
pg_restore --no-owner --no-privileges --dbname "$TARGET_DATABASE_URL" restore.dump
```

Restore into a new, empty database first and check it before pointing the
API at it. `pg_restore` must be version 18 or newer, like the server.

## Testing

```bash
npm run typecheck
npm test                  # 380 integration and 34 unit tests against a real PostgreSQL
```

The same checks run on every push (`.github/workflows/ci.yml`), including a
scan that fails if any query over a company-owned table does not name its
company (`apps/api/test/unit/tenant-scope.spec.ts`).

The integration suite starts its own ephemeral database. It exercises the
accounting rules directly — balanced postings, immutability triggers,
maker-checker, tax reconciliation, year-end close.

## What is not built yet

Stated here rather than discovered later.

- **Tax and payroll start switched off** for a new farm. Each is turned on from
  its own screen (Books → Tax, Money → Payroll setup), which loads the current
  Nigerian statutory rates and asks only for the decisions that belong to the
  farm — whether withholding is computed before or after VAT, NHF
  participation. Those answers are recorded against whoever gave them and
  should be confirmed with the farm's own adviser.
- **Sales and purchases go through approval.** They are translated into O2C
  and P2P orders and sent for approval — deliberately, so there is one posting
  path and one set of tax rules. Self-approval — a maker approving their own
  document when nobody else in the farm could — is a setting (Setup → Approval
  rules), OFF by default because the client's integrity matrix forbids it; a
  one-person farm's CFO can turn it on, and each use is recorded.
- **Only weighted-average costing is built.** Feed and treatments absorbed by a
  population leave it with each death, sale or harvest at weighted average,
  the policy chosen on 2026-09-24. FIFO or standard costing would need their
  own implementation. Relief is exact from that date; feed eaten by animals
  that left before it stays spread over the survivors.
- **Farm labour and overhead** (Books → Farm costing) are shared by
  animal-days or by timesheet hours × each person's pay for the month (Money →
  Timesheets); flocks take theirs into Work in Progress, snails to 612000. On
  animal-days, a month before 2026-09-24 can understate a population that later
  sold live animals, whose counts were not dated then. Hours are logged per
  person, batch and day; only hours approved by someone other than whoever
  logged them count (or self-approved, where nobody else could).
- **Machine depreciation** goes to the machine's processing line, or is split
  by the hours logged on each line that month. Egg value is a dated price per
  crate, with an optional separate price for hatching eggs; rejects carry none.
- **Segment profit or loss is a management view.** Books → Profit & loss → By
  segment shows farm, feed mill and processing for each product, and the two
  products together, with release checks. The feed the mill supplies is
  measured as milled feed issued on the rounds at its store value, shown as
  mill revenue and farm cost, and eliminated; the consolidated column is the
  statutory result. Costs neither product can claim stay in a Shared column
  rather than being spread by a key nobody chose.
- **Weighings are history and need a supervisor.** A weighing (from the round or
  the batch page) is recorded pending, approved or rejected by someone other
  than whoever recorded it, and never edited; the latest approved one is the
  current weight, and biomass, FCR and daily gain read from approved weighings
  only. Target weights come from the breed stages where they are set.
- **Joint cost uses one released method.** Every processing order shares its
  cost between outputs by NRV at split-off (handbook §62) unless a CFO releases
  another (Feed mill → Joint-cost prices). The selling prices NRV reads are
  proposed with evidence and approved by someone else, and a change is a new
  price from a later date. Outputs plus the stated normal and abnormal loss
  must equal the harvested weight before an order is costed.
- **Routing sets standard conversion.** An order with routing is charged
  actual hours × the rate snapshotted from its cost pools; the hours are kept
  on the order's routing lines, and a pool's unused capacity reads them.
- **Onboarding is four steps** (People → Employees → an employee): personal,
  employment, compensation and documents, each marked done only when the
  workbook's Employee_Master_Checks pass it. Pay changes wait for someone
  other than who prepared them; job changes are dated history; a changed bank
  account or TIN clears its verification. Employees on payroll before
  2026-09-25 keep being paid with document gaps shown as warnings; everyone
  else needs a complete pack before activation.
- **References are the system's.** Documents and journals are numbered
  TYPE-ENTITY-SITE-YYYY-000001 by an atomic sequence; the API ignores a number
  sent by a caller. Journals posted before 2026-09-25 keep only their source
  reference.
- **Google and Facebook sign-in are seams, not features.** The flow is ready;
  the credentials must come from your own developer accounts.
- **Bank statements are imported, not fed.** A CSV export from the bank is
  reconciled against the ledger; there is no live bank connection.
- **Interface translations need a native speaker.** The Hausa, Yorùbá and Igbo
  wording was not written by one, and a wrong word on a mortality form produces
  wrong records.

## Licence

Not yet licensed. All rights reserved.
