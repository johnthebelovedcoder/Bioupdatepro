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
npm run db:push         # schema + SQL constraints and triggers
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
| `md@bioassetpro.ng` | Managing director | Everything, and approvals. |
| `admin@bioassetpro.ng` | Administrator | Everything, including staff and invitations. |

Or create your own farm at `/signup` — registration provisions a chart of
accounts, cost centres and twelve open periods in one transaction, so a new
farm can record a round on its first morning.

## Testing

```bash
npm run typecheck
npm test                  # 312 integration tests against a real PostgreSQL
```

The integration suite starts its own ephemeral database. It exercises the
accounting rules directly — balanced postings, immutability triggers,
maker-checker, tax reconciliation, year-end close.

## What is not built yet

Stated here rather than discovered later.

- **Tax rates, approval limits and payroll bands are not provisioned** for a new
  farm. They carry statutory consequences and belong to the farm's own
  accountant. Operations work from day one; a VAT invoice needs these first.
- **Sales and purchases stop at a submitted document.** They are translated into
  O2C and P2P orders and sent for approval — deliberately, so there is one
  posting path and one set of tax rules — but nothing reaches the ledger until
  somebody approves it.
- **Harvest and mortality are not valued.** Both need a costing policy
  (weighted average, FIFO, standard) that is the farm's decision.
- **Google and Facebook sign-in are seams, not features.** The flow is ready;
  the credentials must come from your own developer accounts.
- **Stock levels, staff and the activity feed still read from fixtures.**
  Livestock, health, harvests, feeding and the money figures are real.
- **Interface translations need a native speaker.** The Hausa, Yorùbá and Igbo
  wording was not written by one, and a wrong word on a mortality form produces
  wrong records.

## Licence

Not yet licensed. All rights reserved.
