# Browser walk-through, 4 October 2026

A tester's pass through the running app in headless Chromium: the seeded demo farm (Kajola Farms, four-digit chart), then the same farm after moving it to the approved five-digit chart from the browser, plus a freshly signed-up farm. API on PostgreSQL, web in dev mode, seeded users (`npm run db:seed*`). Everything below was done through the screens, with the database read afterwards to check what posted.

## What was covered

| Area | Result |
|---|---|
| Every static screen (91) as CFO, then as supervisor, farm manager, controller, auditor | All 91 open as CFO. Role-denied screens misbehave (finding 14). |
| Sign-in, wrong password, unknown email, forgot password, sign-out, protected routes | Pass (finding 15 is cosmetic). |
| Sign-up of a new farm, then the cutover on it | Pass. Farm is provisioned in 4 s on the four-digit chart with the approved chart loaded beside it. |
| Buy supplies → purchase order → approval chain → goods receipt → approval (ledger posts) → supplier invoice with a price mismatch → approval → payment → approval | Works on both charts once findings 4 and 5 are fixed. |
| Record a sale → approval → delivery → approval (cost of sales posts) → invoice → approval → customer receipt → approval | Works on both charts once findings 4 and 5 are fixed. |
| Daily round (feed issue, deaths with cause) | Posts on both charts; on the approved chart feed goes to 16032 and deaths relieve it to 51120. |
| Biological asset acquisition ("Retry posting") | Posts Dr 16032 / Cr 20300 on the approved chart. |
| Segregation of duties (nobody approves their own work; multi-level approval; reject needs a reason) | Works. Findings 9 and 10 are about what the screen shows. |
| Reports: trial balance, P&L, balance sheet, cash flow, control reconciliation, before and after the cutover | Balanced and reconciled. P&L had finding 7. |
| The cutover itself, from the Books → Approved chart readiness screen | Preview, choices, approval fields, run, result. Findings 1–3. After it: every balance on the right approved account, items repointed, control accounts agree with their subledgers. |
| Transfers/write-offs, manual journals, payroll, production orders, year-end | Not completed: see "Not covered". |

## Findings, fixed on `claude/chart-cutover-ui-fixes`

Each has a regression test unless it is screen text.

1. **High: the cutover could not be started from the screen on any company that already had posting rules.** Its blocker said "load the approved chart first" but nothing on the page loaded it, and Run stayed disabled. Added a "Load the approved chart" button; the blocker now lists eight accounts and a count, not 77.
2. **Medium: after running, the screen showed no result.** The form disappeared as soon as the company was on the approved chart, taking its success message with it, and left an amber warning over a list of zeros. The result now carries to the page; the three purposes still needing a Finance decision (impairment loss, the two capitalised variances) are listed; stale instructions on the chart and Controls screens and in the README are corrected.
3. **High: stock lines with no item went to the wrong inventory control.** A feed issue credited raw materials with no item on the line; the cutover shared it by what each item type holds, putting ₦145,601.58 against the wrong control, so 12000 and 12100 would have failed their stock-ledger tie-out. Item-less lines are now placed so each control equals the stock ledger's value for its own items (test: `approved-cutover.spec.ts`).
4. **High: on the approved chart, deliveries, goods receipts and invoices failed at approval ("Cost Centre required on … 50000").** Orders raised from Record a sale and Buy supplies carry no cost centre, the approved revenue, cost of sales and inventory accounts require one, and the approval screen swallowed the error (finding 9). The sales and procurement specs that passed in the earlier slices all named a cost centre on the order. Orders now take the company's first usable cost centre when none is named, on the approved chart only; the specs no longer name one.
5. **High: the "Paid from" and "Received into" lists offered every posting account (revenue, receivables, headings), the server accepted any of them, and on the approved chart the bank account (10100, a control account) was not offered at all.** A receipt was recorded into 10000 "Assets". Receipts, supplier payments and payroll payments now list bank accounts only (the bank role's account on any chart plus registered bank accounts) and the server refuses anything else.
6. **Medium: on the approved chart the P&L put cost of sales (50000, 50310…) and abnormal biological loss under operating expense**, overstating gross profit. Added to cost of sales.
7. **High: the income-tax panel on the P&L showed "Cannot GET /api/closing/period/…"**: the screen called `/closing/…`, the API serves `/period/…`. Fixed; the preview now shows 30% of profit before tax.
8. **Low: a vaccine sold from stock had to be classed as "Live birds" in the cutover.** Added "Other goods (general)" (40000 / 50000 / 12400).

## Findings, open when the walk-through ended (see the follow-up below)

9. **Medium: the Approvals screen swallows errors.** An Administrator pressing Approve on a posting document gets "Administrators … cannot post accounting entries" back from the server and the row simply stays; Reject with no reason does nothing visible. Approving a ₦7.26M order is one click with no confirmation or confirmation message.
10. **High: a sale recorded as "Paid now — Cash" creates no receipt.** The review screen says Dr Cash / Cr Sales income; the books get Dr Receivable and the invoice stays open.
11. **High: feed is issued from a different store than purchases are received into.** Goods came in to "Recovery Store"; the daily round issued from "Raw Material Store", which went to −1,200 kg while the total showed 8,800 kg, and a transfer from it was refused.
12. **Medium: a supplier invoice priced above the goods receipt leaves the difference as a debit in GRNI** (₦50,000 here) instead of in a price-variance or inventory account, so GRNI never clears.
13. **Medium: manual journals cannot be used by anyone.** The API needs the Financial Accountant role; the invite and Edit roles screens offer only six roles; a user given the role in the database is told the Journals screen "is not yours"; the CFO sees "Raise a journal" and is refused.
14. **Medium: screens a role may not open fail with HTTP 500** (supervisor on /production, /feed-mill, /inventory/counts; farm manager on /finance/payroll → /finance/payment-files), and the Home screen shows a permission error banner to roles without finance access.
15. **Low:** sign-in throttling shows the raw text "ThrottlerException: Too Many Requests".
16. **Low:** a rejected supplier payment stays "SUBMITTED" in its own table (the workflow says REJECTED).
17. **Low:** the review screens say "Valued … when this is wired up" (unfinished copy); the Buy supplies review shows the effect on the books even when approval will hold it back; "Ready to ship/invoice" still list an order after it was shipped/invoiced; the price field on Buy supplies has no label for screen readers; "Round queued" is shown even when the server later rejects a duplicate day (only the header outbox says blocked); cash can go negative with no warning.
18. **Low, demo data:** deliveries cost at the standard cost (₦14.50 a unit for a vaccine bought at ₦1,500) with no warning; seeded flocks have no journals ("7 populations not posted"); the seeded farm has no ledger postings.
19. **Design note:** the cutover is dated the first day of a future month but the company switches to the approved chart at once, so activity before that date posts to approved accounts while the old balances move on the cutover date. Reports are consistent, but it may surprise.

## Follow-up, 5 October 2026: the open findings

| # | Outcome |
|---|---|
| 9 | **Withdrawn.** The Approvals screen does show the server's refusal and the "Say why you are rejecting it" prompt next to the buttons; the walk-through looked for them in the wrong place. (A one-click approval with no confirmation is left as it is.) |
| 10 | **Fixed (6 October).** A sale recorded as paid now keeps how it was paid on the order (`received_at_sale_method`, migration 0048). Once the invoice is approved it appears on Selling → Invoices under "Paid at the sale, receipt not recorded" with a button that opens the receipt form prefilled (method, customer, invoice, the first bank account); the receipt is still raised and approved the normal way, and the row disappears while one waits for approval. Test in `sales-approved.spec.ts`. |
| 11 | **Fixed.** Goods receipts take the item's own store when it has one (the daily round already issued from it), instead of the order's header store. Test in `procurement-approved.spec.ts`. |
| 12 | **Left for Finance.** Where an invoice's price difference belongs (inventory cost, a price-variance account, or cost of sales when the goods are gone) is an accounting policy; the stock ledger would also need a matching revaluation. No account in the approved chart is named for it. |
| 13 | **Fixed.** The invite and Edit roles screens offer GL/Financial accountant; that role can open Journals; the Raise a journal button shows only to it; the journal form has a cost centre for each line (the approved chart needs one on most accounts, and an approver's click failed without it). Walked through: raised, approved, posted Dr 56000 / Cr 11100 with the cost centre. |
| 14 | **Fixed.** A screen that cannot load now shows "That screen is not yours" (with the server's wording in development) or a plain "could not load" with a way back, and the Home screen no longer shows a permission banner to roles without ledger access. |
| 15 | **Fixed.** "Too many sign-in attempts. Wait a few minutes, then try again." |
| 16 | **Fixed for documents that wait for approval.** A rejected or returned manual journal, supplier payment, customer receipt, goods receipt, supplier invoice, delivery, sales invoice or credit note now says so on the document (rejected means cancelled, returned means draft). Stock and settled quantities move only when a document posts, so nothing needs undoing. Orders and quotations are not changed: they have their own approval lifecycle. Tests in `procurement-approved.spec.ts`, `journals.spec.ts`. |
| 17 | **Fixed (6 October).** "Ready to ship/invoice" no longer list an order once its delivery or invoice is waiting for approval; the daily round banner follows the outbox (waiting, sent, or refused with the server's reason); the supplier and payroll payment forms warn when a payment would overdraw the chosen account (the bank list now carries each account's book balance). The copy and label fixes were done on 5 October. Walked through in the browser on 6 October: a Paid-now sale through approval, delivery and invoice to the prefilled receipt; the ready lists; the overdraft warning on an account already negative; the round banner for a sent round and for a refused duplicate day. |
| 18, 19 | Not changed (demo data; and the cutover-date behaviour is a design decision). |

## Not covered

Inventory transfers and write-offs (blocked by finding 11), manual journals (finding 13), payroll runs, production orders and the feed mill, period close and year-end close from the screen, the snail round, bank statements and reconciliation, staff invitations beyond the form, and mobile layouts. A second pass should cover them once findings 10–13 are decided.
