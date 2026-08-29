-- BioAssetPro — invariants for Procure-to-Pay (§5).
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Money and quantity shape.
-- ---------------------------------------------------------------------------

ALTER TABLE purchase_requisition_lines DROP CONSTRAINT IF EXISTS pr_lines_chk;
ALTER TABLE purchase_requisition_lines ADD CONSTRAINT pr_lines_chk
  CHECK (
    quantity > 0
    AND estimated_unit_cost_kobo >= 0
    AND ordered_quantity >= 0
    AND ordered_quantity <= quantity
  );

ALTER TABLE purchase_order_lines DROP CONSTRAINT IF EXISTS po_lines_chk;
ALTER TABLE purchase_order_lines ADD CONSTRAINT po_lines_chk
  CHECK (
    quantity > 0
    AND unit_price_kobo >= 0
    AND net_amount_kobo >= 0
    AND vat_amount_kobo >= 0
    AND received_quantity >= 0
    AND invoiced_quantity >= 0
  );

-- §5 asks for ordered / received / rejected separately. Accepted is received
-- less rejected, and none of them may be negative or internally inconsistent.
ALTER TABLE goods_receipt_note_lines DROP CONSTRAINT IF EXISTS grn_lines_chk;
ALTER TABLE goods_receipt_note_lines ADD CONSTRAINT grn_lines_chk
  CHECK (
    ordered_quantity >= 0
    AND received_quantity > 0
    AND rejected_quantity >= 0
    AND rejected_quantity <= received_quantity
    AND accepted_quantity = received_quantity - rejected_quantity
    AND unit_price_kobo >= 0
    AND value_kobo >= 0
    AND invoiced_quantity >= 0
  );

-- ---------------------------------------------------------------------------
-- 2. THE GRNI GUARD.
--
--    A receipt line may never be invoiced for more than was accepted into
--    stock. Without this, GRNI would go negative and the phase's identity —
--    that a fully received and invoiced order clears GRNI to exactly zero —
--    would silently stop holding.
-- ---------------------------------------------------------------------------

ALTER TABLE goods_receipt_note_lines DROP CONSTRAINT IF EXISTS grn_lines_no_over_invoice_chk;
ALTER TABLE goods_receipt_note_lines ADD CONSTRAINT grn_lines_no_over_invoice_chk
  CHECK (invoiced_quantity <= accepted_quantity);

ALTER TABLE supplier_invoice_lines DROP CONSTRAINT IF EXISTS supplier_invoice_lines_chk;
ALTER TABLE supplier_invoice_lines ADD CONSTRAINT supplier_invoice_lines_chk
  CHECK (
    quantity > 0
    AND unit_price_kobo >= 0
    AND net_amount_kobo >= 0
    AND vat_amount_kobo >= 0
  );

-- A line that clears GRNI must actually reference the receipt it clears.
-- Otherwise "clears GRNI" is an assertion about nothing.
ALTER TABLE supplier_invoice_lines DROP CONSTRAINT IF EXISTS supplier_invoice_lines_grni_chk;
ALTER TABLE supplier_invoice_lines ADD CONSTRAINT supplier_invoice_lines_grni_chk
  CHECK (clears_grni = false OR goods_receipt_note_line_id IS NOT NULL);

ALTER TABLE supplier_invoices DROP CONSTRAINT IF EXISTS supplier_invoices_settlement_chk;
ALTER TABLE supplier_invoices ADD CONSTRAINT supplier_invoices_settlement_chk
  CHECK (
    net_amount_kobo >= 0
    AND vat_amount_kobo >= 0
    AND gross_amount_kobo >= 0
    AND settled_amount_kobo >= 0
    AND settled_amount_kobo <= gross_amount_kobo
  );

ALTER TABLE supplier_payments DROP CONSTRAINT IF EXISTS supplier_payments_amount_chk;
ALTER TABLE supplier_payments ADD CONSTRAINT supplier_payments_amount_chk
  CHECK (
    amount_kobo >= 0
    AND wht_amount_kobo >= 0
    AND discount_kobo >= 0
    AND (amount_kobo + wht_amount_kobo + discount_kobo) > 0
  );

ALTER TABLE payment_allocations DROP CONSTRAINT IF EXISTS payment_allocations_amount_chk;
ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_amount_chk
  CHECK (amount_kobo > 0);

ALTER TABLE procurement_configurations DROP CONSTRAINT IF EXISTS procurement_configurations_tolerance_chk;
ALTER TABLE procurement_configurations ADD CONSTRAINT procurement_configurations_tolerance_chk
  CHECK (
    quantity_tolerance_percent >= 0 AND quantity_tolerance_percent <= 100
    AND price_tolerance_percent >= 0 AND price_tolerance_percent <= 100
    AND over_receipt_tolerance_percent >= 0 AND over_receipt_tolerance_percent <= 100
  );

ALTER TABLE procurement_configurations DROP CONSTRAINT IF EXISTS procurement_configurations_no_overlap;
ALTER TABLE procurement_configurations ADD CONSTRAINT procurement_configurations_no_overlap
  EXCLUDE USING gist (
    company_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );

-- ---------------------------------------------------------------------------
-- 3. Posted documents are immutable (Rule 2).
--    Status is compared as text: each table has its own status enum, and an
--    untyped literal would be cast to whichever one the trigger is attached to.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_posted_procurement_document()
RETURNS TRIGGER AS $$
DECLARE
  v_reference text;
BEGIN
  -- jsonb rather than a CASE over OLD.<column>: PL/pgSQL compiles every branch
  -- against the actual record type, so naming a column absent from one of the
  -- tables fails even on the branch never taken.
  v_reference := COALESCE(
    to_jsonb(OLD) ->> 'invoice_number',
    to_jsonb(OLD) ->> 'payment_number',
    to_jsonb(OLD) ->> 'grn_number',
    OLD.id::text
  );

  IF (TG_OP = 'DELETE') THEN
    IF OLD.status::text = 'POSTED' THEN
      RAISE EXCEPTION '% is posted and cannot be deleted.', v_reference
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- A posted invoice still moves between POSTED / PART_PAID / PAID as payments
  -- land; those are settlement facts, not edits to the document.
  IF OLD.status::text = 'POSTED'
     AND NEW.status::text NOT IN ('POSTED', 'PART_PAID', 'PAID') THEN
    RAISE EXCEPTION
      '% is posted; correct it with a debit note or an adjusting journal.', v_reference
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_grn_posted ON goods_receipt_notes;
CREATE TRIGGER trg_grn_posted
  BEFORE UPDATE OR DELETE ON goods_receipt_notes
  FOR EACH ROW EXECUTE FUNCTION bap_block_posted_procurement_document();

DROP TRIGGER IF EXISTS trg_supplier_invoice_posted ON supplier_invoices;
CREATE TRIGGER trg_supplier_invoice_posted
  BEFORE UPDATE OR DELETE ON supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION bap_block_posted_procurement_document();

DROP TRIGGER IF EXISTS trg_supplier_payment_posted ON supplier_payments;
CREATE TRIGGER trg_supplier_payment_posted
  BEFORE UPDATE OR DELETE ON supplier_payments
  FOR EACH ROW EXECUTE FUNCTION bap_block_posted_procurement_document();

-- ---------------------------------------------------------------------------
-- 4. Invoice lines freeze once the document leaves draft.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_locked_supplier_invoice_lines()
RETURNS TRIGGER AS $$
DECLARE
  v_status text;
  v_reference text;
BEGIN
  SELECT status::text, invoice_number INTO v_status, v_reference
    FROM supplier_invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);

  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION
      'Supplier invoice % is %; its lines cannot be changed.', v_reference, v_status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_invoice_lines_locked ON supplier_invoice_lines;
CREATE TRIGGER trg_supplier_invoice_lines_locked
  BEFORE INSERT OR UPDATE OR DELETE ON supplier_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION bap_block_locked_supplier_invoice_lines();

-- ---------------------------------------------------------------------------
-- 4b. Purchase order lines freeze once the order leaves draft (US-897-006).
--     PurchaseOrderService.amendOrder() only ever touches a DRAFT order's
--     lines, so this never fights the application's own amendment path —
--     it exists for the same reason the invoice-lines trigger above does:
--     nothing besides that one, audited code path should be able to rewrite
--     a line once a receipt or invoice could plausibly point at it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_locked_purchase_order_lines()
RETURNS TRIGGER AS $$
DECLARE
  v_status text;
  v_reference text;
BEGIN
  SELECT status::text, order_number INTO v_status, v_reference
    FROM purchase_orders WHERE id = COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);

  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION
      'Purchase order % is %; its lines cannot be changed.', v_reference, v_status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_purchase_order_lines_locked ON purchase_order_lines;
CREATE TRIGGER trg_purchase_order_lines_locked
  BEFORE INSERT OR UPDATE OR DELETE ON purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION bap_block_locked_purchase_order_lines();

-- ---------------------------------------------------------------------------
-- 5. Quotation and RFQ shape.
-- ---------------------------------------------------------------------------

ALTER TABLE supplier_quotation_lines DROP CONSTRAINT IF EXISTS supplier_quotation_lines_chk;
ALTER TABLE supplier_quotation_lines ADD CONSTRAINT supplier_quotation_lines_chk
  CHECK (quantity > 0 AND unit_price_kobo >= 0);

ALTER TABLE supplier_quotations DROP CONSTRAINT IF EXISTS supplier_quotations_chk;
ALTER TABLE supplier_quotations ADD CONSTRAINT supplier_quotations_chk
  CHECK (
    total_amount_kobo >= 0
    AND (lead_time_days IS NULL OR lead_time_days >= 0)
    AND (valid_until IS NULL OR valid_until >= quotation_date)
  );
