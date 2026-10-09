# Second browser walk-through, 9 October 2026

The areas the first pass (`docs/qa-walkthrough-2026-10-04.md`) did not reach, on the deployed build (`0f63910`). A clean copy from `npm run setup` on the demo company (four-digit chart), API on PostgreSQL, web in dev mode, headless Chromium. Every role that must enrol an authenticator did so through the screens first. The database was read afterwards to check what was saved.

## What was covered

| Area | Result |
|---|---|
| Transfers and write-offs | Both work. Findings W1, W2. |
| Employee onboarding (record, pay, 9 document checks, second-person pay approval, activation) | Works; strict and clear about what is missing. Segregation holds (the person who set up an employee cannot activate them). |
| Payroll run (calculate, submit, approve, post, pay, approve payment, bank file) | Works end to end; the file's beneficiary, account, bank and amount are right. Finding W3. |
| Banking (add account, import statement, match, difference explained) | Works. Auto-matched the salary payment, flagged the unmatched bank charge, explained the ₦1,000,000 difference. |
| Period close and year-end close | Both guarded: Close is disabled with the reason, and year-end lists every blocking check (all 12 periods open). Checklist steps and findings read clearly. |
| Processing orders and feed mill | Every screen opens. A processing order could not be raised from the demo (no harvest, no feed formula). Finding W5. |
| Snail daily round (mobile) | Works end to end: snail causes and disposal, review, sent, saved on the server. |
| Staff invitations | Invite, one-time link, accept, sign in, land on authenticator setup. Finding W6. |
| Mobile layout, 68 screens at 390 px | No screen scrolls sideways. The roles screen has many small tap targets. |

## Findings

**W3. Medium (tax). PAYE grants pension relief that was never deducted.** An employee enrolled in pension, in a company below the pension headcount threshold (one employee against a minimum), has ₦0 pension deducted but PAYE is still calculated with 8% pension relief. On ₦150,000 a month: PAYE ₦10,700, annual relief ₦144,000, pension ₦0. Without the relief PAYE is ₦12,500, so tax is understated by ₦1,800 a month for that employee. Cause: the PAYE engine grants the relief on the employee's enrolment flag alone (`paye-engine.service.ts`), while the pension deduction also applies the headcount test (`statutory-engine.service.ts`). Relief should follow the contribution actually made.

**W1. Medium (wrong text). The write-off form says it "Posts immediately — a write-off is not sent for approval".** It is not posted immediately: it is raised as pending and waits for a second person (PCR-014), and the page's own footer says so. The requester cannot approve it (refused with a clear message); a CFO's approval posts it. Only the form's text is wrong.

**W2. Medium (control). A stock transfer can be received by the person who issued it, and the receiver is not recorded.** The form says "the person who moved it is not the person who confirms it arrived"; the server does not check, and the transfer has no received-by field. The farm manager received their own transfer. Either enforce it (and record the receiver) or change the sentence.

**W4. Low. After raising a transfer, write-off or employee, the sheet stays open over the page** with the form and a confirmation inside; the person must close it to see the list. Other forms in the app return to the page with a notice.

**W5. Low (observation, server not checked). The feed-mill run form offers processing product recipes** (frozen snail meat and so on) as the thing to mill; the demo has no feed formulas and the form does not tell the two kinds apart.

**W6. Low (text). The authenticator setup page says an authenticator is "required for finance, approval, and administrator access"**, shown to a production supervisor. The rule covers farm managers and supervisors too.

**W7. Observation. Who can do what in payroll.** The run's approval went to the Farm Manager (the amount ladder, up to ₦250,000), so a farm manager approves payroll. The finance manager cannot open the People area, so they cannot be the second approver of an employee's pay (the administrator was). Setting up and paying one employee took four people: the CFO (prepared the record, pay and the run), the administrator (approved the pay and activated the employee), the farm manager (approved the run and the payment) and the finance manager (raised the payment). That is thorough, and heavy for a small farm; confirm it is intended.

## Not covered

Stock counts, leave, timesheets, the fixed-asset register and disposals, tax filing, approval delegations, egg and incubation flows, and a processing order with real harvest data. The demo has no stock, so transfers and write-offs used opening stock inserted directly into the stock ledger (which has no matching ledger entry); reconciliation was therefore not checked in that part.
