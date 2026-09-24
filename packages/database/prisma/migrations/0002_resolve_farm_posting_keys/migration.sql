-- Five posting keys that were "A or B per policy" are resolved by code built
-- on 2026-09-24: feed and treatments capitalise into the population's Work in
-- Progress (1501), and a live sale relieves its weighted-average share to Cost
-- of Sales (5001). New farms get these from the provisioning map; this brings
-- farms that loaded their posting rules before then into line. A data-only
-- migration: it touches only keys still unresolved, never one a farm set.

UPDATE "posting_keys" SET "dynamic_resolution" = CASE "key"
  WHEN 'PCR-042-CR' THEN 'OperationsPostingService.postFeedIssues() — the issued item’s own inventory account (Item.inventoryGlAccountId, else 1301), taken out of the store at WAC'
  WHEN 'PCR-062-DR' THEN 'OperationsPostingService.postFeedIssues() — capitalised into the flock’s Work in Progress (1501), relieved at weighted average'
  WHEN 'PCR-063-DR' THEN 'OperationsPostingService.postTreatment() — capitalised into the flock’s Work in Progress (1501)'
  WHEN 'PCR-063-CR' THEN 'OperationsPostingService.postTreatment() — Raw Material Inventory (1301), the store the medication came from'
  WHEN 'PCR-073-CR' THEN 'RearingCostService.relieve(DISPOSAL) — the sold birds’ weighted-average share out of Work in Progress (1501) to Cost of Sales (5001)'
END,
"updated_at" = NOW()
WHERE "key" IN ('PCR-042-CR', 'PCR-062-DR', 'PCR-063-DR', 'PCR-063-CR', 'PCR-073-CR')
  AND "atomic" = false
  AND "dynamic_resolution" IS NULL;
