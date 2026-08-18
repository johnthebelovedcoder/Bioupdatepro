# Farm ERP — Product Analysis & Architecture Proposal

**Status:** Proposal. Nothing in this document has been implemented. Awaiting approval.
**Date:** 10 August 2026

---

## 0. The single most important fact

This is not a greenfield project. There is already a substantial, tested codebase, and it
covers roughly the *opposite half* of the spec from what is missing.

**What already exists and works** — 97 database models, 312 passing integration tests across
9 suites:

| Spec section | Status | Notes |
|---|---|---|
| §14 Inventory | **Built** | Items, stock movements, standard costs, valuation |
| §15 Procurement | **Built** | Requisition → RFQ → PO → GRN → invoice → payment, with GRNI |
| §16 Sales | **Built** | Quote → order → delivery → invoice → receipt → credit note → return |
| §17 Customers | **Built** | With ageing and statements as views over the ledger |
| §18 Finance | **Built, and well beyond the spec** | Full double-entry GL, not "operational finance" |
| §21 Staff (partial) | **Built** | Employees, payroll, PAYE, statutory deductions |
| §30 Audit log | **Built** | Append-only, enforced by database trigger |
| §36 Security (partial) | **Partly built** | Authentication yes; tenant isolation **no** — see §8 |

**What does not exist at all** — not one model, field, or line of code:

| Spec section | Status |
|---|---|
| §7 Farm management (buildings, pens, sections) | **Missing** (a "Farm" exists only as an accounting tag) |
| §8–10 Poultry batches, daily records, broiler metrics | **Missing** |
| §11–12 Snail colonies, breeding, lifecycle | **Missing** |
| §13 Feed consumption recording | **Missing** (feed exists as an inventory item only) |
| §19 Batch profitability | **Missing** (the ledger can support it; nothing computes it) |
| §20 Health, vaccination | **Missing** |
| §22 Tasks | **Missing** |
| §23 Daily farm log | **Missing** |
| §25 Notifications | **Missing** |
| §5 Multi-tenancy | **Missing** |

Concretely, here is the entire `PenHouse` model as it stands today:

```prisma
model PenHouse {
  id, farmId, code, name, active
  farm, journalLines, manualJournalLines
}
```

A pen has a name, and its only relationships are *to journal lines*. It has no population,
no capacity, no occupancy, no stocking date. Nothing in the schema knows that anything
lives on this farm.

So the work ahead is not "build a farm ERP". It is **"build the operational half, and
connect it to the financial half that already exists."** That is a materially different
—and much better— starting position, but only if we resist rebuilding what is there.

---

## A. Understanding of the product

A **farm operating system** for commercial poultry and snail producers in Nigeria, which
answers three questions continuously: what do I have, what happened, and am I making money.

The third question is the differentiator. Four competitors were reviewed (CluckFlow,
NaijaPoultryHub, SmartFlok, BIMSPro). All four record farm operations well. **None does
real accounting** — no general ledger, no double entry, no trial balance, no statutory
VAT/WHT/PAYE, no period close. Two of them give farm record-keeping away *free* and
monetise a marketplace instead.

That sets the strategy sharply:

- Operational record-keeping is **table stakes**, priced at zero by the market. We must
  have it, and it will not be what we sell.
- Accounting-grade financial truth is **absent from the entire competitive set**, and it
  is what we already have.
- The buyer who pays is therefore the **commercial farm** — one with an accountant, an
  auditor, a board, or a bank facility — not the smallholder.

The product line is: *the only farm system whose numbers a bank and an auditor will
accept.* Competitors can tell you laying dropped 8%. We can tell you the batch lost
₦340,000 and show the costed breakdown that ties to the income statement.

### The core domain insight

Spec §32 says livestock are not ordinary inventory. Correct, and it does not go far enough.

A batch of 2,000 layers is not a quantity. It is a **cost object**: an accumulating pool of
feed, medication, labour and overhead that yields eggs and, eventually, spent birds. That
is precisely what a Work-in-Progress account is. The system already has WIP with a
tested identity, dimension tagging, and overhead drivers.

So the correct model is not "batch table with a cost column". It is:

```
Batch = an operational population record  +  a WIP cost object in the ledger
```

This matters because of §19. Your batch profitability example —

```
Revenue ₦16,100,000 · Feed ₦4,800,000 · Medication ₦420,000 · Labour ₦350,000 …
```

— *is a WIP account statement.* If it is computed by summing expense rows with ad-hoc SQL,
it will not reconcile to the P&L, and the two numbers will drift apart within a quarter.
If the batch is a real GL cost object, batch profit provably ties to the income statement.
That is the entire difference between a farm app and a farm ERP.

---

## B. Recommended MVP

Your §33 Phase 1 lists 18 items. That is still too large for a first release, and about
half of it is already done. Recommended MVP, in dependency order:

### MVP-0 — Foundations (must precede everything)
1. **Multi-tenancy**: Organization → Company → Farm, with database-enforced isolation.
2. **RBAC**: server-side, tied to organisation and farm membership.
3. Fix the authorisation holes described in §H below.

### MVP-1 — Operations core
4. Farm structure: Farm → Building/House → Section/Pen.
5. Species-agnostic **Batch** (poultry batch, snail colony are two configurations of one model).
6. **Lifecycle events**, append-only: placement, feeding, mortality, production, weight,
   movement/transfer, harvest, health.
7. Feed consumption that decrements inventory automatically (§39).
8. Mortality that decrements batch population automatically.

### MVP-2 — The bridge (this is the differentiator; do not defer it)
9. **Event → posting rules**, effective-dated configuration: feed issue debits batch WIP,
   harvest credits WIP to finished goods, abnormal mortality writes off to expense.
10. **Batch profitability** read directly from the ledger.

### MVP-3 — Surfaces
11. Owner/manager dashboard (§6).
12. Mobile worker view: today's tasks, record feeding / mortality / production (§28).
13. Daily farm log (§23).
14. Core reports: production, mortality, inventory, batch profitability.

### Deliberately deferred
- Tasks & scheduling beyond a simple daily checklist
- Health/vaccination module (records only in MVP; reminders later)
- Attendance
- Notifications beyond low-stock and unusual-mortality
- Offline sync (architecture prepared, not implemented — see §G)
- All AI/forecasting
- IAS 41 fair-value biological asset measurement

**Already done, do not rebuild:** inventory, procurement, sales, customers, payroll,
GL, tax, period close, audit log.

---

## C. Technology architecture

Recommendation: **keep the existing stack.** It is already chosen, installed, tested, and
appropriate. Changing it now would discard 312 passing tests for no product gain.

| Layer | Technology | Rationale |
|---|---|---|
| Monorepo | Turborepo + npm workspaces | In place |
| API | NestJS 10 + TypeScript | In place; module boundaries already clean |
| Database | PostgreSQL 17 | In place; invariants enforced by triggers/constraints |
| ORM | Prisma 6 | In place |
| Web | Next.js 15 App Router, React 19 | In place; server components, httpOnly session |
| Auth | JWT, httpOnly cookie, scrypt | In place |
| Tests | Vitest against real Postgres | In place; 312 passing |

**Additions proposed:**

- **PostgreSQL Row-Level Security** for tenant isolation. This is the important one. With
  97 models, isolation cannot depend on every developer remembering a `where` clause. RLS
  enforces it at the engine, which matches the project's existing philosophy — the money
  invariants are already enforced by triggers rather than application code, deliberately.
- **A domain event table** (append-only) as the operational spine, with the posting rules
  engine as a consumer. This is what makes offline sync and future AI possible.
- **PWA** for the worker experience rather than a native app. One codebase, installable,
  service-worker offline capable. Native only if hardware access (camera weighing, RFID)
  later demands it.
- Nothing else. No new UI framework, no state library, no ORM change.

### Deployment

Single Postgres, single API process, single Next process to start. The architecture is
horizontally scalable later because state lives in the database, but premature
microservices would be the wrong call at this size.

---

## D. Database / entity architecture

### D.1 Tenancy (new, and required first)

```
Organization          ← tenant root; billing, subscription, locale, currency
  └── Company         ← legal entity; files its own tax returns  (EXISTS)
        └── Branch    ← (EXISTS)
              └── Farm  ← (EXISTS, but only as an accounting tag)
                    └── Building / House
                          └── Section / Pen   (PenHouse EXISTS, needs real fields)
```

Why both Organization *and* Company: a company is a legal entity with its own tax
registration and its own set of books — that is an accounting boundary we already model
correctly. An organisation is the customer who pays us and may own several companies. They
are not the same thing and collapsing them will hurt later.

**Membership**, replacing today's global `User.roles: String[]`:

```
User            ← global identity (email, password)
Membership      ← User × Organization, with roles
FarmAccess      ← Membership × Farm, for workers restricted to one site
```

### D.2 Livestock (new)

Species-agnostic, per your instruction not to hard-code chickens and snails:

```
Species              ← POULTRY, SNAIL, (FISH, GOAT … later). Configuration, not code.
Breed                ← Isa Brown, Cobb 500, Archachatina marginata …
LifecycleStage       ← per species: CHICK/GROWER/LAYER, or EGG/HATCHLING/JUVENILE/BREEDER
ProductionMetricDef  ← which KPIs apply to which species+purpose
```

`ProductionMetricDef` is what stops layer metrics being forced onto broilers (§10). Hen-day
production applies to layers; FCR applies to broilers; hatch rate applies to snail breeding.
This must be configuration or the system cannot take a fifth species without a rewrite.

```
Batch                ← THE central entity
  organizationId, companyId, farmId, sectionId
  speciesId, breedId, purpose
  batchCode, sourceSupplierId, acquiredOn
  openingQuantity, currentQuantity        ← derived, never hand-edited
  currentStageId, status
  wipAccountId + costCentreId             ← the ledger bridge
```

`currentQuantity` is a **materialised projection of the event log**, not an independently
editable field. Anything else guarantees drift between the population and its history.

### D.3 The event log (new — the operational spine)

One append-only table, discriminated by type, rather than a dozen near-identical tables:

```
BatchEvent
  id, organizationId, batchId, occurredOn, recordedById
  type          ← PLACEMENT | FEED | MORTALITY | PRODUCTION | WEIGHT
                  | TRANSFER | STAGE_CHANGE | TREATMENT | HARVEST | ADJUSTMENT
  quantity, unitOfMeasureId
  payload (jsonb)   ← type-specific: egg grade, cause of death, vaccine, photo ref
  clientEventId     ← idempotency key, client-generated (offline sync)
  journalEntryId    ← set when this event has posted to the ledger
```

Rationale for one table over many:
- Every event needs the same treatment: append-only, audited, dated, dimensioned,
  idempotent, and postable. Ten tables means ten copies of that logic.
- The daily farm log (§23) is a single query.
- Offline sync has one conflict-resolution path, not ten.
- AI (§26) trains on one uniform event stream.

Typed views (`PoultryDailyRecord`, `SnailBreedingRecord`) are provided as **database views**
for reporting convenience, not as separate write paths.

Specialised tables are still warranted where the shape genuinely differs:

```
SnailBreedingCycle   ← breeding group → eggs laid → hatched → hatch rate (spans weeks)
HealthIncident       ← disease episode with symptoms, diagnosis, treatments, outcome
VaccinationSchedule  ← plan vs administered, with due dates
```

### D.4 The ledger bridge (new)

```
EventPostingRule
  organizationId, speciesId (nullable = all), eventType
  effectiveFrom, effectiveTo        ← effective-dated, per the standing rule
  debitAccountId, creditAccountId
  valuationMethod   ← STANDARD_COST | ACTUAL_COST | ISSUE_PRICE | NONE
  condition (jsonb) ← e.g. mortality above the normal curve
```

Illustrative rules (all configuration, none hard-coded):

| Event | Debit | Credit |
|---|---|---|
| Feed issued to batch | WIP (batch cost centre) | Feed inventory |
| Medication applied | WIP | Medication inventory |
| Labour allocated | WIP | Payroll clearing |
| Normal mortality | *no posting* — absorbed into surviving birds' unit cost | — |
| Abnormal mortality | Abnormal loss expense | WIP |
| Eggs collected | Finished goods | WIP |
| Snails harvested | Finished goods | WIP |
| Sale | *existing O2C pipeline, unchanged* | |

Every posting goes through the **existing `PostingService`** — the same door, the same
dimension validation, the same idempotency, the same audit record. No module gets its own
ledger.

### D.5 Supporting (new)

```
Task, TaskAssignment, RecurringTaskTemplate
Notification, NotificationRule    ← thresholds configurable, never hard-coded (§25)
FarmActivity (view over BatchEvent + inventory + sales + purchases)
```

### D.6 Indexing and constraints

- Every tenant-scoped table carries `organizationId` and is covered by an RLS policy.
- `BatchEvent`: `(organizationId, batchId, occurredOn)`, `(organizationId, type, occurredOn)`.
- `BatchEvent.clientEventId` unique per organisation — idempotent offline replay.
- Trigger: `BatchEvent` is append-only, same as `AuditRecord` today.
- Constraint: `Batch.currentQuantity >= 0`; mortality exceeding population is refused.
- Constraint: an event may not be recorded against a batch before its placement date.

---

## E. Main user journeys

**Owner, Monday morning (mobile or desktop).** Opens dashboard → sees population, eggs
yesterday, mortality, cash position, month revenue vs expense → taps a red mortality alert
→ sees Batch L-2026-001 mortality 40% above its normal curve → drills to the batch → sees
feed intake fell two days before the deaths → messages the manager.

**Manager, daily.** Reviews yesterday's submitted records → approves an unusual mortality
entry → checks low-stock alerts → raises a purchase requisition for layer feed (existing
P2P) → assigns today's tasks.

**Worker, in the pen, on a phone, poor signal.** Opens app → today's tasks listed → taps
"Feed Poultry House 1" → quantity pre-filled from yesterday → confirms → taps "Collect
Eggs" → enters whole/cracked/dirty on a numeric keypad → taps "Record Mortality" → enters
5, picks a cause, optionally photographs → submits. Everything queues locally and syncs
when signal returns. The worker never sees a price.

**Accountant, month end.** Runs the period-close checklist (already built) → reviews GRNI
ageing → posts accruals → confirms batch WIP balances against production records → closes
the period → runs batch profitability, which ties to the income statement because it is the
same ledger.

**Snail supervisor, breeding cycle.** Records a breeding group of 300 → later records 450
eggs laid → later 381 hatchlings → system computes an 84.7% hatch rate and moves the
population into the hatchling stage, preserving the history.

---

## F. Application sitemap

Adopting your §4 navigation, with items marked by build state:

```
Dashboard                                     NEW

Farm Operations
  Farms · Buildings · Pens                    NEW (Farm exists as a tag only)
  Daily Activity Log                          NEW
  Tasks                                       NEW (phase 2)

Livestock
  Poultry:  Batches · Production · Feeding ·
            Mortality · Weight · Health       NEW
  Snails:   Colonies · Breeding · Hatching ·
            Growth · Feeding · Harvest        NEW

Inventory
  Feed · Medication · Packaging · Equipment   EXISTS (needs UI)
  Stock movements · Valuation                 EXISTS (needs UI)

Procurement
  Suppliers · POs · Goods received            EXISTS (needs UI)

Sales
  Customers · Products · Orders · Invoices ·
  Payments · Receivables                      EXISTS (needs UI)

Finance
  Income · Expenses · Cash flow · P&L         EXISTS (needs UI)
  Trial balance · Journals · Audit trail      EXISTS + UI BUILT
  Period close · Year end                     EXISTS (needs UI)

Staff
  Users · Roles · Permissions                 NEW (RBAC)
  Employees · Payroll                         EXISTS (needs UI)

Reports                                       Mixed
Settings                                      NEW
```

Note the pattern: most of the right-hand column is *"exists, needs UI"*. A large part of
the remaining work is surfacing capability that is already built and tested.

---

## G. Major business rules

Stated with assumptions explicit, per your §35 instruction.

**Population**
```
current = opening + placements + transfers_in − mortality − transfers_out − harvested − sold
```
Derived from the event log. Never hand-edited. A correction is a compensating ADJUSTMENT
event with a reason, never an overwrite.

**Mortality rate**
```
daily   = deaths_today ÷ population_at_start_of_day
cumulative = total_deaths ÷ opening_population
```

**Hen-day egg production** (layers only)
```
hen-day % = eggs_collected ÷ average_live_birds_that_day × 100
```
*Assumption:* average live birds = (opening + closing) ÷ 2. Some producers use opening
count. **Needs your confirmation** — it changes reported performance by roughly the daily
mortality rate.

**FCR** (broilers/growers only)
```
FCR = total_feed_consumed_kg ÷ total_weight_gain_kg
```
*Assumption:* weight gain is measured live-weight, from sampled weighings extrapolated to
the population. **Needs confirmation** whether sale weight or last sample is authoritative.

**Snail hatch rate**
```
hatch rate % = hatchlings ÷ eggs_laid × 100
```

**Normal vs abnormal mortality** — the most consequential rule, and it is an *accounting*
rule, not just an operational one:
- Normal mortality is expected. Its cost stays in WIP and is absorbed by the surviving
  animals, raising cost per live bird.
- Abnormal mortality must be written off to expense in the period, not capitalised into
  the survivors.

This requires a **configurable normal-mortality curve per species/breed/age**. Your spec
does not define one, and I will not invent thresholds — see open questions.

**Cost per live animal**
```
cost per head = WIP balance ÷ current population
```

**Batch profitability**
```
revenue − (feed + medication + labour + allocated overhead) = gross profit
ROI = gross profit ÷ total cost
```
All components read from the ledger, so the figure reconciles to the P&L by construction.

**Inventory on feed consumption** — recording consumption issues stock at the configured
valuation method and posts to WIP in the same database transaction. Consumption exceeding
available stock is **refused with a readable message**, not silently allowed negative.

**Currency** — all money is stored as integer **kobo**; nothing is ever a float. Rounding
happens once, at persistence. Already implemented and tested.

---

## H. Risks and architectural issues

Ordered by severity.

### H.1 There is no tenant isolation whatsoever — **critical**

Verified in the schema: zero occurrences of `Organization`, `organizationId`, or
`tenantId`. `User` has **no** link to a company or organisation. Every authenticated user
is global.

### H.2 Company-scoped endpoints trust the client — **critical, and my own defect**

The reporting endpoints I wrote take the company from the query string:

```ts
async trialBalanceReport(@Query('companyId') companyId: string, …)
```

Nothing verifies that the caller may see that company. Any signed-in user can read any
company's trial balance, journals or audit trail by changing a URL parameter. This is a
textbook IDOR and it is my error — I introduced it. It must be fixed before anything is
deployed anywhere. There is also no `RolesGuard` anywhere in the codebase: authentication
exists, **authorisation does not**.

### H.3 Offline sync conflicts with an immutable ledger — **high**

A worker offline for three days cannot be allowed to post into a period that has since
closed. Recommendation:
- Operational events sync freely with client-generated idempotency keys.
- The **ledger posting** is derived server-side at sync time, and is subject to the normal
  period gate.
- An event whose date falls in a closed period is accepted operationally but posts to the
  current open period with a stated reason, and is flagged for the accountant.

This must be decided now because it shapes the event schema. It cannot be retrofitted.

### H.4 Retrofitting tenancy across 97 models is expensive — **high**

It gets worse with every model added. This is the strongest argument for doing MVP-0 first.

### H.5 Scope — **high**

The specification describes perhaps 18–24 months of work. The MVP in §B is roughly 3–4
months on top of what exists. The risk is not technical; it is attempting all of it.

### H.6 Commercial: the operational layer is priced at zero — **high**

Two competitors give farm management away free. Anything in MVP-1 alone is not sellable.
MVP-2 (the ledger bridge) is what creates something nobody else has. If MVP-2 slips, the
product has no commercial wedge.

### H.7 Biological asset valuation is still unspecified — **medium**

IAS 41 governs how living assets are measured. The documentation was never supplied. It is
not needed for the MVP under the cost model, but a farm with an auditor will eventually ask.

### H.8 `Farm` and `PenHouse` must change meaning — **medium**

They currently exist as accounting dimensions referenced by journal lines. Giving them
operational substance is additive, but the migration needs care as journal lines already
point at them.

---

## I. What I recommend changing from your specification

1. **Do not build the "simple operational finance" of §18.** You already own a full
   double-entry system with statutory tax and period close. Building a parallel simple
   income/expense tracker would create two sets of numbers that disagree. Instead, *feed*
   the existing ledger from operations. This is the single biggest change I recommend.

2. **Batches are cost objects, not records with a cost field.** §32 is right that livestock
   are not inventory; the corollary is that a batch is a WIP account. Adopt that and §19
   batch profitability becomes provable rather than approximate.

3. **Move multi-tenancy and RBAC to the front.** Your §33 has them scattered through phases
   1 and 2. They are foundations and a security property, and they get more expensive with
   every model added.

4. **One event table, not ten record tables.** Your §31 lists `PoultryDailyRecord`,
   `EggProduction`, `BirdMortality`, `BirdWeight`, `SnailMortality`, `SnailGrowthRecord`
   and more. These share identical requirements. One discriminated, append-only event table
   with typed views gives the daily log, offline sync and future AI for free.

5. **Make species a configuration, not a module.** Your §2 asks for fish, goats, cattle
   later. If "poultry" and "snail" are separate modules, the fifth species is another
   module. If species, lifecycle stages and applicable metrics are data, the fifth species
   is a configuration screen.

6. **Decide the offline model now** (see H.3), even though implementation is deferred.

7. **Normal-mortality thresholds must be configurable and sourced.** §25 already says don't
   hard-code thresholds; I would extend that to the accounting treatment, which is more
   consequential than the alert.

8. **Reconsider "not a bloated corporate ERP" (§1) against what you already own.** The
   accounting depth is not bloat — it is the moat the competitor scan identified. The right
   response is to *hide* it behind a farm-shaped interface, not to remove it. A worker
   should never see a journal; the accountant should have a full trial balance.

9. **Add reversal/correction UX explicitly.** Posted records are immutable by design. Field
   staff make mistakes constantly. The product needs a first-class "correct this entry"
   flow that creates a compensating event, or users will fight the system.

---

## J. Phased roadmap

| Phase | Contents | Rough effort | Gate |
|---|---|---|---|
| **0. Secure the foundation** | Organization/Company/membership, RLS, RBAC guards, fix H.2 | 2–3 weeks | No user can reach another org's data; proven by test |
| **1. Farm & livestock core** | Farm→building→pen; species config; Batch; event log; population projection | 3–4 weeks | Record a batch and its daily events end to end |
| **2. The ledger bridge** | Event→posting rules; feed issue; harvest; abnormal mortality; batch WIP | 3–4 weeks | Batch profitability reconciles to the P&L, proven by test |
| **3. Surfaces** | Dashboard; mobile worker flow; daily log; core reports | 4–5 weeks | A farm can run a full week on it |
| **4. Expose what exists** | UI for inventory, procurement, sales, expenses, payroll, period close | 4–6 weeks | The accountant works only in this system |
| **5. Operational depth** | Health, vaccination, tasks, notifications, staff | 4–6 weeks | — |
| **6. Field-hardening** | PWA offline sync, photo capture, low-bandwidth | 4–6 weeks | Works with no signal for a day |
| **7. Intelligence** | Forecasting, anomaly detection, benchmarking, IAS 41 fair value | Open | Needs real data first |

Phases 0–3 are the defensible product. Phase 4 is largely surfacing work already paid for.

---

## Open questions requiring your decision

1. **Hen-day production denominator** — average live birds, or opening count?
2. **FCR weight basis** — sale weight or last sample?
3. **Normal mortality curve** — do you have breed-standard mortality tables, or should I
   source published breed standards (Isa Brown, Cobb 500) and mark them as researched
   rather than client-confirmed?
4. **Offline conflict policy** (H.3) — is the proposed treatment acceptable?
5. **Organization vs Company** — do any target customers operate more than one legal
   entity? If never, the model can be collapsed and simplified.
6. **Biological asset valuation** — proceed on the cost model and defer IAS 41 fair value?
7. **Do you want the existing accounting modules surfaced in phase 4, or earlier?** If the
   accountant is the paying buyer, there is an argument for pulling it forward.
