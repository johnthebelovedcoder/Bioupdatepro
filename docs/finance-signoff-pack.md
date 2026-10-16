# Finance sign-off pack: the approved five-digit chart

For the Finance Manager, Controller or CFO. Engineering has built the three missing accounts and the price-difference policy to its own recommendations so nothing blocks the cutover; they are marked as proposals in the chart and Finance should confirm or change them. The crosswalk approval has to carry a real person's name and is not filled in. Nothing here has been approved on Finance's behalf.

## Where each item stands

| # | Item | State | Needed from Finance |
|---|---|---|---|
| 1 | Approve the account crosswalk | **Open.** The cutover refuses without it | Name of the approver and the reference of the approval |
| 2 | Account for **impairment loss** | **Proposed and built:** 52800 "Impairment loss - property, plant and equipment" | Confirm, or name a different account |
| 3 | Accounts for the **finished-goods and WIP capitalised variances** | **Proposed and built:** 12490 "Finished goods - capitalised variance", 13190 "Work in progress - capitalised variance" | Confirm, or choose to fold them into inventory |
| 4 | **Supplier invoice price-difference policy** | **Built:** into stock cost | Confirm, or switch to 53000 Material price variance |

## 1. Approving the crosswalk

The crosswalk maps every old account (four- and six-digit) to its approved five-digit account. The full review sheet is `docs/approved-coa-crosswalk-review.csv`; its "Review status" column reads "Standards-based recommendation — not finance sign-off" on every row, and its "Finance-approved target code" and "Effective date" columns are empty for Finance to fill. The role map and its engineering notes are in `docs/target-coa-role-crosswalk.md`.

Engineering proposals Finance should look at specifically (listed in `docs/target-coa-decision.md`):

- processing material is credited to 12000 (the workbook's processing consumption rule), not 12200 by item class;
- finished feed is held in 12450 while farm feed issues credit 12100;
- one utilities account (52200) carries the overhead pool where the crosswalk lists 52200 / 52300 / 52400;
- the recovery variance sits in 53500 where the crosswalk would split it by nature across 53000–53600.

When approved, the person running the cutover (CFO only) types the approver's name and the approval reference on Books → Chart. Both are written to the audit trail with the journal. There is a dry-run preview first, and a rehearsal record in `docs/cutover-rehearsal-2026-10-04.md`.

## 2. Impairment loss

The workbook has no impairment loss account for fixed assets (51200 is inventory write-down; 52400 is depreciation). The approved chart now carries **52800 Impairment loss - property, plant and equipment** (expense, posting account, operating or Core cost centre), added to `approved-posting-engine.json` with a developer note saying it is an engineering proposal pending Finance confirmation. IAS 36 impairment posts there, and an old balance on 5502 or 630200 moves there at the cutover. (An earlier draft of this pack suggested 52500; that number is already Veterinary and treatment expense, so 52800 is used.)

## 3. Capitalised variances (finished goods and WIP)

The old chart kept the difference between standard and actual cost that is capitalised into finished goods and into work in progress in two accounts. The approved chart now carries **12490 Finished goods - capitalised variance** and **13190 Work in progress - capitalised variance** (asset posting accounts, asset-owning operating cost centre), marked as proposals in the same way. Old balances on 1402 / 130590 and 1403 / 130595 move there at the cutover.

The alternative is to fold the variance into the inventory accounts themselves (FG 12410 / 12420 / 12450 and the WIP accounts 13110 / 13120 / 13200), which needs no new accounts but makes the variance invisible. Engineering recommends keeping them separate so the variance can be reviewed at period end.

## 4. Supplier invoice price differences (already built)

When a goods-matched supplier invoice is priced above or below its goods receipt, the app now clears goods received not invoiced (20300) at the receipt price and books the difference to the item's own inventory account, with a matching revaluation of the stock ledger. Any share of the goods already used goes to cost of sales instead. This is the "into stock cost" policy.

The alternative is to expense it as a purchase price variance. The workbook already has an account for that, **53000 Material price variance**, so no new account would be needed. Say if Finance prefers it and engineering will switch it over.

## If Finance changes a proposal

- A different account for 2 or 3: change the number in `chart.ts` (`ROLE_ACCOUNTS`), the crosswalk in `approved-crosswalk.ts` and the account row in `approved-posting-engine.json`; the unit and cutover tests check them against each other. About an hour.
- Expensing price differences to 53000 instead: one change in `supplier-invoice.service.ts` (debit 53000, drop the stock revaluation).
- Crosswalk approval: nothing to build. The approver's name and reference are typed on the Chart screen when the cutover is run.

## Who should sign

Recommended, so the approval stands up to audit:

| Decision | Signs | Why |
|---|---|---|
| 1. Crosswalk approved | **Finance Controller**, countersigned by the **CFO** | It re-classifies every balance in the ledger. |
| 2. Impairment loss account | **Finance Controller** | A chart and reporting decision. |
| 3. Capitalised variance accounts | **Finance Controller** | A chart and costing decision. |
| 4. Price-difference policy | **Finance Manager**, noted by the Controller | A purchasing and stock-cost decision. |

The person who runs the cutover (CFO only) should not be the only approver. Type the Controller's name and the approval reference on Books → Chart, so the audit trail shows two people. The reference should point to something that can be produced later: a signed copy of this page, or a dated email from the approver.

## Sign-off record

| Decision | Decided by | Date | Reference / account |
|---|---|---|---|
| 1. Crosswalk approved | | | |
| 2. Impairment loss account | | | |
| 3. Finished-goods capitalised variance account | | | |
| 3. WIP capitalised variance account | | | |
| 4. Price-difference policy confirmed | | | |
