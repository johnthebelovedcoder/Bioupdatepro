-- BioAssetPro — close packs are append-only (§8 audit evidence).
--
-- A close pack is the record of what the ledger said at close. Changing or
-- deleting one would defeat its purpose, so neither is allowed, from any
-- connection. A reopened and re-closed period gets a new pack beside the old.
--
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION bap_close_pack_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Close packs are append-only and cannot be %.', lower(TG_OP) USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_close_packs_append_only ON close_packs;
CREATE TRIGGER trg_close_packs_append_only
  BEFORE UPDATE OR DELETE ON close_packs
  FOR EACH ROW EXECUTE FUNCTION bap_close_pack_append_only();
