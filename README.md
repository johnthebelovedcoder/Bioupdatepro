# BioAssetPro

An accounting-grade agritech ERP. Pilot modules: **SnailPro** and **PoultryPro**.

This is a financial system, not a prototype. Every accounting rule in the source
specifications is a hard requirement.

---

## Non-negotiable rules

These are enforced structurally — in the type system, the service layer and the
database — not by convention.

| # | Rule | Where it is enforced |
|---|---|---|
| 1 | Money is an integer count of minor units (kobo) | `Kobo` branded bigint (`common/money.ts`); `BigInt` columns; no float anywhere near an amount |
| 2 | Posted transactions are immutable | Postgres triggers (`prisma/sql/010_constraints.sql`) **and** Prisma middleware |
| 3 | Every GL line carries the full Enterprise Dimension set | `NOT NULL` on the mandatory six; `DimensionValidatorService` for conditionals |
| 4 | Maker-checker is structural | Service layer (Phase 2 — Workflow Engine) |
| 5 | One Workflow Engine, one Tax Engine | Phases 2 and 3; every module calls them |
| 6 | Idempotency keys on every posting endpoint | Unique index on `(scope, key)` + `IdempotencyService` |
| 7 | The WIP identity holds exactly | Phase 6, with an automated regression test |
| 8 | Nothing species-specific is hard-coded | Recipes, rates, GL mappings and requirement flags are all configuration rows |
| 9 | Every workflow event and posting writes an immutable audit record | `AuditService`, written in the same transaction; append-only trigger |
| 10 | No invented business logic | Where the spec is silent, we ask — see `docs/assumptions.md` |

---

## Repository layout

```
apps/
  api/                  NestJS backend
    src/
      common/           money.ts (Rule 1), errors.ts
      prisma/           PrismaService + immutability middleware
      enterprise-dimensions/   §1.1 dimension block and validator
      audit/            Rule 9
      idempotency/      Rule 6
      periods/          §8 period status gate
      posting/          THE posting service — the only path into the GL
      reporting/        Trial balance and dimensional queries
      masters/          Phase 1 read/create endpoints
    test/               Unit + integration suites
packages/
  database/             Prisma schema, SQL invariants, seed
scripts/
  pg-dev-server.mjs     In-process Postgres for local dev
```

---

## Getting started

```bash
npm install
```

### Database

Any Postgres works. If you do not have one, this repo can run Postgres
in-process (PGlite over the wire protocol — a real server, no Docker):

```bash
npm run db:start
```

Then, in another terminal:

```bash
npm run db:push
npm run db:seed
```

`db:push` applies the Prisma schema **and** the SQL invariants in
`packages/database/prisma/sql/`. Those SQL files are not optional decoration —
they are where Rule 2 and Rule 9 actually hold.

### Tests

```bash
npm test
```

The integration suite starts its own Postgres if `DATABASE_URL` is unset, so it
needs no setup. Point `DATABASE_URL` at a managed Postgres for CI and it will
use that instead.

---

## Phase 1 — Core platform (this phase)

**Delivered**

- Company, Branch, Department, Cost Centre (hierarchical), Chart of Accounts
- Financial Year / Period with `OPEN → SOFT_CLOSED → CLOSED → ARCHIVED`
- Currency and effective-dated exchange rates
- Farm, Pen/House, Project, Warehouse dimension masters
- The Enterprise Dimension block and its validator
- **`PostingService`** — the single write path into the General Ledger
- `AuditService`, `IdempotencyService`, `PeriodService`
- `TrialBalanceService` with dimensional filtering
- Database-level immutability, single-side and balance constraints

**Proved by tests**

- A balanced posting commits; an unbalanced one is refused
- A missing mandatory dimension is refused
- A missing cost centre is refused *only* on accounts configured to need one
- A line contradicting its header is refused
- Another company's cost centre is refused
- Summary and inactive accounts are refused
- Closed periods refuse everyone; soft-closed periods admit only finance roles
- A replayed idempotency key returns the original result and posts nothing new
- The same key with a different body is a hard error
- `UPDATE` / `DELETE` against a posted journal fails **at the database**
- Audit records cannot be updated or deleted by any path
- Reversal produces a mirror document and leaves the original untouched
- The trial balance balances after every posting

**Deferred, and why**

- *Workflow states beyond Draft → Posted* — Phase 2. The posting service
  contract does not change when they arrive.
- *Business dimensions (Customer, Supplier, Employee, Item)* — Phase 4, with
  their master tables. Additive nullable columns.
- *The Batch dimension* — Phase 5, with `BiologicalBatch`.
- *Period close as a governed process* — Phase 11. Phase 1 exposes a direct
  status setter so the posting gate is testable; it is not the close process.
- *Exchange-rate revaluation* — not specified in any source document, so not
  built (Rule 10).

---

## Build order

1. **Core platform** ← this phase
2. Workflow & Approval Engine
3. Tax Engine (VAT/WHT)
4. Master data
5. ⚠ Biological Batch source interface — *blocked on Stage 7 / IAS 41 documentation*
6. Processing engine → SnailPro → cost allocation → PoultryPro
7. Procure-to-Pay
8. Order-to-Cash
9. HR & Payroll (PAYE + Statutory engines)
10. Manual Journal / Adjustment Centre
11. Period-End & Year-End Closing

See `docs/implementation-plan.md` for the full plan, the source-document
findings, and the open questions.
