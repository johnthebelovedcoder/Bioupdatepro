# Third walk-through, 10 October 2026

A deep pass over the areas the first two walk-throughs left alone, plus a run of
every automated check as the evidence base for the client's control register. A
clean copy from `npm run setup` on the demo company (four-digit chart), API on
PostgreSQL, web in dev mode, headless Chromium. Every role signed in through the
real screens. The database was read afterwards to check what was saved, and each
posting was tied back to the account it hit.

## Automated checks

All green on `605b244`, run before the browser pass:

| Check | Result |
|---|---|
| API integration — the suite the control register cites as evidence | **59 files, 605 tests, 0 failures** (10 min) |
| API unit | 15 files, 92 tests, 0 failures |
| API TypeScript (source and tests) | clean |
| Web TypeScript | clean |

This closes the evidence gap `final-readiness-closeout.md` recorded against the
88 rows in `control-gap-register.md`: the last complete run on 2 October had
nine failures, and the whole suite now passes.

## What was covered

| Area | Result |
|---|---|
| Buying: order, approval ladder, goods receipt, rejection | Works. Postings tie out. |
| Stock counts | Works end to end. Findings T2 (fixed in PR 15), T6. |
| Fixed assets: capitalise, depreciate, impair | Works; arithmetic correct to the naira. |
| Fixed asset disposal | **Broken. Finding T1.** |
| Approval delegations | Works, and the audit trail records who acted for whom. |
| Leave | Works. Entitlement, certificate and segregation all enforced. |
| Timesheets | Works. Day cap and segregation enforced. |
| Eggs: collection, incubation, hatch | Works end to end for a finance role. Finding T3. |
| Employee onboarding | Works; the checklist is strict about what is missing. |
| Tax returns register | Opens and lists VAT/WHT periods, due dates and overdue status. |
| Processing order from a harvest | Not reachable: no batch is harvest-ready in the demo. See "Not covered". |

### Controls proved against the ledger, not just the screen

- **Amount ladder.** A ₦324,000 purchase order needed the Farm Manager *and*
  then the Finance Manager; the Farm Manager's approval alone moved it to level
  2 rather than completing it. A ₦3,600,000 asset needed three levels. A
  ₦2,500,000 disposal needed three. Nothing posted at order approval.
- **Goods receipt.** Dr 1301 Raw Material Inventory ₦308,800 / Cr 2140 Goods
  Received Not Invoiced ₦308,800, balanced. 20 rejected bags of the 300
  delivered were excluded from both the stock ledger and the amount owed, which
  is what the form promises.
- **Stock count segregation.** The counter was refused with the control quoted:
  "You counted this store, so someone else approves the count (INT-009)." On a
  second person's approval the shortage and surplus posted: Dr 640100 ₦2,100 /
  Cr 1301 ₦2,100 and Dr 1301 ₦1,900 / Cr 640100 ₦1,900, against a count of 495
  against a book of 500 and 265 against 260.
- **Depreciation.** ₦60,000 for one month on ₦3,600,000 over 60 months, Dr 5501
  Depreciation Expense / Cr 1702 Accumulated Depreciation.
- **Impairment (IAS 36).** Carrying ₦3,540,000 down to a recoverable ₦2,000,000
  gave a loss of ₦1,540,000, Dr 5502 Impairment Loss - Fixed Assets / Cr 1702.
  5502 is the account the crosswalk maps to the proposed 52800.
- **Delegation.** The Controller lent authority to the Finance Manager for a
  window; the Finance Manager then approved at the Controller's level and
  `workflow_history` recorded that step with `on_behalf_of_id` set.
- **Leave.** Annual leave the employee had not yet earned was refused ("0 days
  available on 2026-10-19; 5 asked for. Take unpaid leave for the rest"); sick
  leave requires a medical certificate; the requester was refused with "You
  requested this leave, so someone else approves it."
- **Timesheets.** 26 hours in one day refused; "You logged 2 of these entries
  yourself, so someone else approves them"; only approved hours count toward
  sharing wages.
- **Eggs.** A collection of 400 hatching / 150 table / 20 reject, set to
  incubate, then hatched 352 with 40 unhatched and 8 damaged — the form requires
  the three to add up to the number set. A new 352-bird flock was created and
  the incubation batch closed.

## Findings

**T1. High (correctness). A fixed asset that was never depreciated cannot be
disposed of, and the approver is told nothing. Fixed in this PR.** Capitalising
an asset and disposing of it before any depreciation run leaves accumulated
depreciation at zero. The disposal journal emits its accumulated-depreciation
line unconditionally, so that line carries a zero debit and no credit; the
balanced-journal guard rejects the posting with "Line 1 has neither a debit nor
a credit", and the disposal sits at its last approval level for ever. The
approvals screen swallows the error — the approver clicks Approve, the row does
not move, and no message appears. The net-book-value line immediately below
already had the `> 0n` guard this line was missing
(`apps/api/src/fixed-assets/fixed-asset.service.ts`). A regression test covers
it; it reproduces the exact error without the fix. **The silent swallow is not
fixed** — an approval that fails server-side should say so, and that is a
separate change to the approvals screen.

**T2. Medium. A store with no book stock cannot be counted at all. Fixed in PR
15.** Starting a
count on an empty store is refused with "RAW-WH holds nothing to count. Name the
items to count." — but the form offers only a store and a recount threshold,
with no way to name an item. The API already accepts `itemIds`
(`stock-count.service.ts`), so the field was missing from the screen, not the
service. This matters most at go-live and for finding stock the books do not
show, which is exactly when a count is worth doing. The form now offers to name
the items instead of counting everything held.

**T3. Medium (permissions and honesty). A production supervisor cannot record an
egg collection, and is told the wrong reason. Fixed in PR 15; the pattern behind
it swept in PR 18.** On PoultryPro → Incubation the
collection form says "No active poultry flock" while four flocks are active and
laying. The cause is that the egg controller's `@Roles` omits
`PRODUCTION_SUPERVISOR`
(`apps/api/src/poultry-egg/poultry-egg.controller.ts`), so the API refuses the
request, and the web helper turns any error into an empty list
(`apps/web/src/lib/poultry-eggs.ts` — `catch { return []; }`). The same form
lists all four flocks for the CFO.

The egg controller now carries `POULTRY_SUPERVISOR` and `PRODUCTION_SUPERVISOR`,
which the incubation log beside it had listed as its recorders all along — the
two had drifted; setting the egg value stays finance-only on its own narrower
guard. The helper returns `null` rather than `[]` when it cannot read the list,
and the form says the list is unavailable instead of claiming there are no
flocks. A unit test pins the two controllers together.

The unit test immediately surfaced one more gap, since settled: `QA_OFFICER`
kept the incubation log but could not record a collection. Grading into
hatching, table and reject is a quality call, so the farm settled it the same
way as the log and the role now records collections too. That needed the web
section as well as the API role — a QA officer had `dashboard` and `inventory`
only, so neither the egg screen nor the incubation log was reachable, and the
API grant alone would have changed nothing. The two lists now agree role for
role with nothing exempt, which is what makes the drift test worth having.

**The pattern behind the wrong message, swept.** `catch { return [] }` turns any
failure into "there are none", so a refusal reads as an empty farm. Twenty-seven
helpers did it. Two were lying to somebody already: a Farm Manager holds the
`money` section, so they reach Money → Payroll runs and Money → Journals, while
both APIs are finance-only — and both screens told them "No payroll run yet" and
"No manual journal yet", inviting an action they cannot take. Neither was found
by three walk-throughs, because finding them needs signing in as that role on
that screen.

Screens whose subject is the data no longer catch at all: the refusal reaches
the error boundary the first walk-through's finding 14 built, which already says
"That screen is not yours". The swallow was what defeated it. Where falling back
to empty is genuinely right — a side panel, a picker's reference list, the
notification inbox that sits on every page — it goes through a named `optional()`
helper that logs and reads as the deliberate choice it is.

**T4. Medium (deployment). Two migration runs at once break each other. Fixed in
PR 15 — and the first diagnosis below was wrong.**

What was seen: a run of `npm run setup` applied all 51 migrations and then
stopped at `030_tax_constraints.sql` with `duplicate key value violates unique
constraint "pg_extension_name_index"` on `btree_gist`; a second run succeeded.
This was first written up as "fails on a clean database". **That is not true.** A
full migrate against a freshly created database applies all 19 SQL files
cleanly, verified afterwards.

The real cause is concurrency, and here it was self-inflicted: two `npm run
setup` runs were overlapping in the test container. `CREATE EXTENSION IF NOT
EXISTS` checks the catalogue and then inserts, so two runs reaching 030 together
both pass the check and the slower one fails on the unique index, taking the
whole migration down with it. Reproduced deliberately: two concurrent sessions,
one succeeds and one fails with exactly that error.

It is worth fixing rather than dismissing, because it is reachable in
production: the API runs `db:migrate` from its start command (`render.yaml`), so
two instances starting together — or a deploy overlapping a manual run — race
the same way. `prisma migrate deploy` already holds an advisory lock for its own
run; the constraint step had none and now takes one.

**T5. Compliance. The ledger is written in two chart generations at once.** The
demo company is on `chartVersion` LEGACY and carries 35 four-digit and 68
six-digit active accounts side by side. Real postings landed in both: the goods
receipt in 1301/2140, the stock-count adjustment in 640100, depreciation in
5501/1702. The trial balance therefore lists four- and six-digit accounts
together and still balances (₦312,800 each side). The application is honest
about this — Books → Approved chart readiness reports "0 of 137 approved
accounts present" and "103 active accounts outside the target chart" — so this
is a known state awaiting the cutover rather than a hidden defect. It is
recorded here because it is the condition the Finance crosswalk approval
resolves.

**T6. Low. A sheet is shown to a role that may not use it, and refuses only on
submit.** The CFO is offered the whole "Start a count" form and learns only
after submitting that "This needs one of: Storekeeper, Farm Manager, Farm
Accountant, Production Lead." The refusal is clear and correctly enforced; it
arrives later than it needs to.

**T7. Low. W4 is not fully closed.** PR 11 made master-data forms, transfers and
write-offs return to the page on success. The capitalise-asset sheet still stays
open over the page with its confirmation inside it, because it is its own
component rather than a master form.

**T8. Observation. Two navigation entries point at paths with no page.**
`/procurement/receive` and `/approvals/history` both 404; each exists only as a
`[id]` route. Both entries are marked `hidden: true`, and the search palette
rewrites a hidden entry to its section, so nobody can click through to the 404 —
it is reachable only by typing the URL.

## Not covered

A processing order against real harvest data: no batch is harvest-ready in the
demo (0 of 8 — every one lacks an approved weighing, and the broiler flock also
has an overdue fowl-pox withdrawal), and the screen correctly refuses to raise
an order without one. The order-from-harvest path is covered by the passing
`processing-approved`, `snail-processing-approved` and `poultry-processing`
integration suites instead. Also not covered: asset transfer and the per-machine
hours split, stock-count recount above the threshold, bank reconciliation a
second time, and the approvals screen's behaviour when a posting fails (T1).
