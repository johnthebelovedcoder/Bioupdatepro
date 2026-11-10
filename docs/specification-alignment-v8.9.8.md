# Client specification alignment: v8.9.8

## Authority and scope

Use the v8.9.7 stories for the general application acceptance and posting controls. Use the v8.9.8 handbook for biological master data and lifecycle details, where it explicitly supersedes the earlier material. The handbook's build sequence is a dependency guide; it does not waive the v8.9.7 acceptance evidence and sign-off requirements.

## Biological master data release rules

- Placement must select an active breed/species master and a stage configured for that master. Do not accept an arbitrary breed or stage label.
- An estimated hatch date must retain its evidence basis and supervisor approval attribution. After a group has daily records, stage changes, weighings, or disposals, direct date edits are locked; corrections require a controlled correction workflow.
- Negative populations are blocked by application and database controls. Weight history stays immutable and the current value comes only from an approved weighing.
- A supervisor checklist named `BIO_MASTER_CHECKS` reports approved master data, provenance, stage/age consistency, quantities, weighing approval, and pending hatch-date reviews. Its sign-off is saved to the audit trail and included in overall release sign-off. Production and daily-record APIs remain usable while a farm resolves issues; client UAT must confirm the intended operational release boundary.
- Mortality causes are company-scoped master records by species. Only active configured labels are accepted, and the event stores the cause code.

## Financial statement mapping

`GLAccount.fsCategory` is the governed statement placement. P&L and Balance Sheet must consume it. Accounts with ledger activity that remain unclassified, or whose category conflicts with account type, block the statement and return the accounts to finance for classification. Current and non-current placement is finance-owned; do not infer it from account numbers.

Standard cost remains the inventory/production posting basis where the approved posting rules require it. WAC may support farm-level actual or management costing. The two measures must be labelled and reconciled; do not silently substitute one for the other in inventory postings.

## Operational exceptions and remaining acceptance evidence

Purchased livestock must enter through an approved purchase order and accepted GRN. The group now retains a foreign-key link to its GRN line; hatchlings and produced groups retain a parent-group foreign key. Opening balances and migrations use the manual placement workflow with a required source reference. Legacy records receive no fabricated provenance and appear as exceptions in `BIO_MASTER_CHECKS`.

Before client acceptance, execute positive and negative biological UAT paths, save the evidence, and obtain named sign-off. Code changes alone do not satisfy those acceptance artifacts.

## Finance-owned release blockers

- Poultry/snail immature-versus-mature classification is now a nullable field on each breed-stage master. Finance Manager, Controller, or CFO must set it; absent, conflicting, or invalid values block approved-chart postings and cutover. No engineering proposal is auto-loaded as approved.
- The v8.9.7 chart cutover and account-level crosswalk remain gated by Finance approval. The workbook posting-control rows are loaded, but not every posting path dynamically executes all 669 control lines. Do not invent mappings for unresolved split balances or engineering-proposed accounts.
- Existing accounts with activity must receive approved FS categories before P&L and Balance Sheet can render. This is a one-time finance configuration step, not something code can infer reliably from account numbers.
