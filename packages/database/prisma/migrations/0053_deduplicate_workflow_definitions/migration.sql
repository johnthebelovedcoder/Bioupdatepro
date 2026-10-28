-- Remove approval ladders that were provisioned twice.
--
-- PERIOD_REOPEN was listed twice in the routes every farm is provisioned with
-- (from 2026-09-27 until the list was corrected), so each farm got two
-- identical company-wide ladders for it. Routing refuses a tie rather than
-- guess between equally specific definitions, so the duplicate did not leave a
-- harmless extra row: it blocked the document type outright. A finance team
-- that closed a month by mistake could not get it reopened.
--
-- Correcting the list stops new farms inheriting it. Every farm provisioned in
-- the last month still carries the rows, so they are removed here.
--
-- Rows are matched on everything routing uses to choose between them: the
-- company, the transaction type, all five scope columns and the effective
-- dates. Anything differing in any of those is a real, distinct ladder and is
-- left alone.
--
-- Which of an identical pair survives: the one carrying workflow transactions.
-- Deleting that one would detach approvals from the ladder they were approved
-- under, and that history is the audit record. Only when neither has any does
-- age decide, oldest winning, so a definition someone has since edited is the
-- one kept. (Keeping the oldest unconditionally looked right until it was run:
-- where the younger row held the history, the older empty one was kept, the
-- younger was protected, and the tie the migration exists to break survived
-- intact. For PERIOD_REOPEN nothing could route through a tie, so there is no
-- history to find — but this deletes by shape rather than by type, and the
-- rule has to hold for whatever shape it meets.)
--
-- A pair that both carry transactions is left alone: that is a genuine
-- ambiguity in the audit trail and a person has to choose. It cannot arise
-- from this bug. Steps are removed by the cascade on workflow_steps.
DELETE FROM "workflow_definitions" AS d
WHERE NOT EXISTS (
  SELECT 1 FROM "workflow_transactions" AS t WHERE t."definition_id" = d."id"
)
AND EXISTS (
  SELECT 1
  FROM "workflow_definitions" AS keep
  WHERE keep."company_id" = d."company_id"
    AND keep."transaction_type" = d."transaction_type"
    AND keep."name" = d."name"
    AND keep."auto_post_on_approval" = d."auto_post_on_approval"
    AND keep."active" = d."active"
    AND keep."effective_from" = d."effective_from"
    AND keep."effective_to" IS NOT DISTINCT FROM d."effective_to"
    AND keep."branch_id" IS NOT DISTINCT FROM d."branch_id"
    AND keep."farm_id" IS NOT DISTINCT FROM d."farm_id"
    AND keep."department_id" IS NOT DISTINCT FROM d."department_id"
    AND keep."cost_centre_id" IS NOT DISTINCT FROM d."cost_centre_id"
    AND keep."currency_id" IS NOT DISTINCT FROM d."currency_id"
    AND (
      -- Carries the history, so it survives whatever its age.
      EXISTS (SELECT 1 FROM "workflow_transactions" AS kt WHERE kt."definition_id" = keep."id")
      -- Otherwise the older row wins; the tie-break on equal timestamps
      -- leaves exactly one standing.
      OR (keep."created_at", keep."id") < (d."created_at", d."id")
    )
);
