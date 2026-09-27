# Offline work and document numbers (NUM-UAT-03)

**Status:** a decision for the client (Phase 0). No number blocks are built.

## What the handbook asks

Document numbers are continuous and every number is accounted for. The numbering UAT (NUM-UAT-03) asks what happens to numbers when a device works offline.

## How the app works today

- **Numbers come only from the server.** A farm worker offline in a pen records the round on the phone. The phone queues it with a key made once, when it is queued (`apps/web/src/lib/sync-queue.ts`). When the signal returns, the queue sends items one at a time, oldest first, and the server gives each document its number as it posts.
- **Nothing is sent twice.** A retry after a timeout reuses the same key, and the server returns the first result instead of posting again (the `idempotency_records` table).
- **The numbers have no gaps and follow the order documents are saved.** There is one sequence per company, document type, site and year (`PO-AGR-LAG-2026-000001`; `apps/api/src/numbering/numbering.ts`). It is incremented atomically in the same database transaction as the document. A document that fails to save rolls its number back, and a trigger stops a sequence ever going backwards.
- **Nothing offline can be lost silently.** An item stays on the phone, visibly, until the server confirms it. One that cannot be posted is marked "blocked" with the reason, for a person to deal with.

## What number blocks would add

Blocks would reserve a range of numbers (say 100) for each phone ahead of time. The phone could then print or write a final number on a paper slip at the pen, before any signal. The cost:

- **Gaps.** A lost or retired phone leaves reserved numbers unused, and each has to be voided and explained.
- **Order.** Numbers stop following posting order. Device 2's block can post before device 1's.
- **An extra reconciliation.** Every reserved number, per device, has to be shown as used, voided or still held.

## Recommendation

Keep numbers assigned at sync. It meets the control's intent: continuous numbers, every one accounted for, nothing duplicated or lost. It is also simpler and gap-free. Build blocks only if the farm must hand out a final document number on paper at the pen before the phone has a signal.

**Question for the client:** Do workers ever need to give someone a final document number before their phone has a signal (for example, a delivery note handed to a driver at a remote gate)?
- If not, record this note as the answer to NUM-UAT-03.
- If so, blocks get built. That is about two days' work.
