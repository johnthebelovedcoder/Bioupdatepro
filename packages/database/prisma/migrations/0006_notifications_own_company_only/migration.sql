-- Approval notifications were addressed to everyone holding the approving role
-- in ANY company, so users of one farm were sent (and could read in their
-- in-app inbox) another farm's document references and amounts. Fixed in
-- WorkflowService.notifyLevel and EscalationService.notifyRole on 2026-09-25;
-- this removes the ones already recorded, in-app and queued email alike, so
-- the email dispatcher never sends them.
DELETE FROM "workflow_notifications" n
USING "workflow_transactions" t, "users" u
WHERE t."id" = n."transaction_id"
  AND u."id" = n."recipient_id"
  AND (u."company_id" IS NULL OR u."company_id" <> t."company_id");
