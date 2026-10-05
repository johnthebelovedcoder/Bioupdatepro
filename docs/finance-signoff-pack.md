# Finance sign-off pack: the approved five-digit chart

For the Finance Manager, Controller or CFO. Everything engineering can do on this chart is done and tested; what remains are decisions only Finance can make, and one approval that has to carry a real name. This page lists each one, what the app does today, the options, and what engineering recommends. Nothing here has been decided or approved on Finance's behalf.

## What is waiting on Finance

| # | Decision | Blocks | Needed from Finance |
|---|---|---|---|
| 1 | Approve the account crosswalk | The balance cutover (it refuses to run) | Name of the approver and the reference of the approval |
| 2 | Account for **impairment loss** | Any company holding a balance on the old impairment account (5502 / 630200) | One approved account |
| 3 | Accounts for the **finished-goods and WIP capitalised variances** | Any company holding a balance on the old accounts (1402 / 130590, 1403 / 130595) | Two approved accounts, or the decision to fold them into inventory |
| 4 | Confirm the **supplier invoice price-difference policy** | Nothing (already built to the recommendation) | Yes / no, or a different account |

## 1. Approving the crosswalk

The crosswalk maps every old account (four- and six-digit) to its approved five-digit account. The full review sheet is `docs/approved-coa-crosswalk-review.csv`; its "Review status" column reads "Standards-based recommendation — not finance sign-off" on every row, and its "Finance-approved target code" and "Effective date" columns are empty for Finance to fill. The role map and its engineering notes are in `docs/target-coa-role-crosswalk.md`.

Engineering proposals Finance should look at specifically (listed in `docs/target-coa-decision.md`):

- processing material is credited to 12000 (the workbook's processing consumption rule), not 12200 by item class;
- finished feed is held in 12450 while farm feed issues credit 12100;
- one utilities account (52200) carries the overhead pool where the crosswalk lists 52200 / 52300 / 52400;
- the recovery variance sits in 53500 where the crosswalk would split it by nature across 53000–53600.

When approved, the person running the cutover (CFO only) types the approver's name and the approval reference on Books → Chart. Both are written to the audit trail with the journal. There is a dry-run preview first, and a rehearsal record in `docs/cutover-rehearsal-2026-10-04.md`.

## 2. Impairment loss

The workbook's accounts have no impairment loss for fixed assets. The closest existing accounts are:

| Account | Name | Fit |
|---|---|---|
| 51200 | Inventory write-down expense | Inventory impairment only, so the wrong class for plant and equipment |
| 52400 | Depreciation expense | Right area, but mixes a different kind of charge into depreciation |

**Recommendation:** add a dedicated expense account, "Impairment loss — property, plant and equipment" (suggested number 52500, next to depreciation), to the approved chart. The app would then post IAS 36 impairment there. Until an account is named, a balance on the old impairment account blocks the cutover for that company (a company with no such balance is not affected).

## 3. Capitalised variances (finished goods and WIP)

The old chart kept the difference between standard and actual cost that is capitalised into finished goods and into work in progress in two separate accounts. The workbook names none. Options:

| Option | Effect |
|---|---|
| A. Fold into the inventory accounts themselves (FG 12410 / 12420 / 12450 and the WIP accounts 13110 / 13120 / 13200) | No new accounts; inventory is carried at actual cost; the variance is no longer visible separately |
| B. Add two asset accounts, "Finished goods — capitalised variance" and "WIP — capitalised variance" | Keeps the variance visible and reversible; two more accounts for Finance to maintain |

**Recommendation:** B, because the old chart kept them visible and the variance should be reviewable at period end. Either way the cutover refuses until one is chosen for each.

## 4. Supplier invoice price differences (already built)

When a goods-matched supplier invoice is priced above or below its goods receipt, the app now clears goods received not invoiced (20300) at the receipt price and books the difference to the item's own inventory account, with a matching revaluation of the stock ledger. Any share of the goods already used goes to cost of sales instead. This is the "into stock cost" policy.

The alternative is to expense it as a purchase price variance. The workbook already has an account for that, **53000 Material price variance**, so no new account would be needed. Say if Finance prefers it and engineering will switch it over.

## What engineering does once Finance has decided

- For 2 and 3: add the named accounts to the approved chart and the role map (`chart.ts`, `approved-crosswalk.ts`), then re-run the cutover preview; the blockers clear. About half a day with tests.
- For 4, if changed: one change in `supplier-invoice.service.ts` to debit 53000 instead of the inventory account, with the stock revaluation removed.
- For 1: nothing. The approval is typed on the Chart screen when the cutover is run.

## Sign-off record

| Decision | Decided by | Date | Reference / account |
|---|---|---|---|
| 1. Crosswalk approved | | | |
| 2. Impairment loss account | | | |
| 3. Finished-goods capitalised variance account | | | |
| 3. WIP capitalised variance account | | | |
| 4. Price-difference policy confirmed | | | |
