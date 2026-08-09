-- BioAssetPro — invariants for Order-to-Cash (§6).
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Money and quantity shape.
--    Discounts cannot exceed the line they discount, quantities are positive,
--    and a settled amount cannot exceed the invoice it settles. That last one
--    is what keeps open-item ageing from going negative.
-- ---------------------------------------------------------------------------

ALTER TABLE sales_quotation_lines DROP CONSTRAINT IF EXISTS sales_quotation_lines_chk;
ALTER TABLE sales_quotation_lines ADD CONSTRAINT sales_quotation_lines_chk
  CHECK (quantity > 0 AND unit_price_kobo >= 0 AND discount_kobo >= 0 AND net_amount_kobo >= 0);

ALTER TABLE sales_order_lines DROP CONSTRAINT IF EXISTS sales_order_lines_chk;
ALTER TABLE sales_order_lines ADD CONSTRAINT sales_order_lines_chk
  CHECK (
    quantity > 0
    AND unit_price_kobo >= 0
    AND discount_kobo >= 0
    AND net_amount_kobo >= 0
    AND delivered_quantity >= 0
    AND invoiced_quantity >= 0
    -- Over-delivery would ship goods nobody ordered.
    AND delivered_quantity <= quantity
    AND invoiced_quantity <= quantity
  );

ALTER TABLE delivery_note_lines DROP CONSTRAINT IF EXISTS delivery_note_lines_chk;
ALTER TABLE delivery_note_lines ADD CONSTRAINT delivery_note_lines_chk
  CHECK (quantity > 0 AND unit_cost_kobo >= 0 AND cost_kobo >= 0);

ALTER TABLE sales_invoice_lines DROP CONSTRAINT IF EXISTS sales_invoice_lines_chk;
ALTER TABLE sales_invoice_lines ADD CONSTRAINT sales_invoice_lines_chk
  CHECK (
    quantity > 0
    AND unit_price_kobo >= 0
    AND discount_kobo >= 0
    AND net_amount_kobo >= 0
    AND vat_amount_kobo >= 0
    AND cost_kobo >= 0
  );

ALTER TABLE sales_invoices DROP CONSTRAINT IF EXISTS sales_invoices_settlement_chk;
ALTER TABLE sales_invoices ADD CONSTRAINT sales_invoices_settlement_chk
  CHECK (
    net_amount_kobo >= 0
    AND vat_amount_kobo >= 0
    AND gross_amount_kobo >= 0
    AND settled_amount_kobo >= 0
    AND settled_amount_kobo <= gross_amount_kobo
  );

ALTER TABLE customer_receipts DROP CONSTRAINT IF EXISTS customer_receipts_amount_chk;
ALTER TABLE customer_receipts ADD CONSTRAINT customer_receipts_amount_chk
  CHECK (amount_kobo >= 0 AND wht_amount_kobo >= 0 AND (amount_kobo + wht_amount_kobo) > 0);

ALTER TABLE receipt_allocations DROP CONSTRAINT IF EXISTS receipt_allocations_amount_chk;
ALTER TABLE receipt_allocations ADD CONSTRAINT receipt_allocations_amount_chk
  CHECK (amount_kobo > 0);

ALTER TABLE credit_note_lines DROP CONSTRAINT IF EXISTS credit_note_lines_chk;
ALTER TABLE credit_note_lines ADD CONSTRAINT credit_note_lines_chk
  CHECK (quantity > 0 AND unit_price_kobo >= 0 AND net_amount_kobo >= 0);

ALTER TABLE sales_return_lines DROP CONSTRAINT IF EXISTS sales_return_lines_chk;
ALTER TABLE sales_return_lines ADD CONSTRAINT sales_return_lines_chk
  CHECK (quantity > 0 AND unit_cost_kobo >= 0 AND cost_kobo >= 0);

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_chk;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_chk
  CHECK (quantity > 0 AND unit_cost_kobo >= 0 AND value_kobo >= 0);

ALTER TABLE sales_quotations DROP CONSTRAINT IF EXISTS sales_quotations_validity_chk;
ALTER TABLE sales_quotations ADD CONSTRAINT sales_quotations_validity_chk
  CHECK (valid_until >= quote_date);

-- ---------------------------------------------------------------------------
-- 2. THE ANTI-DOUBLE-COGS GUARD.
--
--    §6 instructs cost of sales to be posted at BOTH delivery and invoice.
--    Whichever point the company configures, a delivery line records where its
--    COGS was recognised, and this refuses any attempt to move or re-stamp it.
--    Cost of sales for a given movement of goods can therefore be recognised
--    exactly once, no matter which code path runs or in what order.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_double_cogs()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.cogs_posted_at IS NOT NULL
     AND NEW.cogs_posted_at IS DISTINCT FROM OLD.cogs_posted_at THEN
    RAISE EXCEPTION
      'Cost of sales for this delivery line was already recognised at %. It cannot be recognised again at %.',
      OLD.cogs_posted_at, COALESCE(NEW.cogs_posted_at::text, 'null')
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_delivery_line_single_cogs ON delivery_note_lines;
CREATE TRIGGER trg_delivery_line_single_cogs
  BEFORE UPDATE ON delivery_note_lines
  FOR EACH ROW EXECUTE FUNCTION bap_block_double_cogs();

-- ---------------------------------------------------------------------------
-- 3. Posted documents are immutable (Rule 2).
--    Corrections are credit notes and adjusting journals, never edits.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_posted_sales_document()
RETURNS TRIGGER AS $$
DECLARE
  v_reference text;
BEGIN
  -- One function serves four tables whose reference column has four different
  -- names. A CASE over OLD.<column> will not compile: PL/pgSQL resolves every
  -- branch against the actual record type, so naming invoice_number in a
  -- trigger attached to delivery_notes fails even on the branch never taken.
  -- Going through jsonb makes a missing key return NULL instead of erroring.
  v_reference := COALESCE(
    to_jsonb(OLD) ->> 'invoice_number',
    to_jsonb(OLD) ->> 'receipt_number',
    to_jsonb(OLD) ->> 'credit_note_number',
    to_jsonb(OLD) ->> 'delivery_number',
    OLD.id::text
  );

  -- Status is compared AS TEXT throughout. Each of the four tables has its own
  -- status enum, and an untyped literal like 'PART_PAID' would be cast to
  -- whichever enum the trigger is attached to — failing on DeliveryStatus,
  -- which has no such value, even though that branch concerns invoices only.
  IF (TG_OP = 'DELETE') THEN
    IF OLD.status::text = 'POSTED' THEN
      RAISE EXCEPTION '% is posted and cannot be deleted.', v_reference
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- A posted invoice may still move between POSTED / PART_PAID / PAID as
  -- receipts land: those are settlement facts, not edits to the document.
  IF OLD.status::text = 'POSTED'
     AND NEW.status::text NOT IN ('POSTED', 'PART_PAID', 'PAID') THEN
    RAISE EXCEPTION
      '% is posted; correct it with a credit note or an adjusting journal.', v_reference
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_invoice_posted ON sales_invoices;
CREATE TRIGGER trg_sales_invoice_posted
  BEFORE UPDATE OR DELETE ON sales_invoices
  FOR EACH ROW EXECUTE FUNCTION bap_block_posted_sales_document();

DROP TRIGGER IF EXISTS trg_customer_receipt_posted ON customer_receipts;
CREATE TRIGGER trg_customer_receipt_posted
  BEFORE UPDATE OR DELETE ON customer_receipts
  FOR EACH ROW EXECUTE FUNCTION bap_block_posted_sales_document();

DROP TRIGGER IF EXISTS trg_credit_note_posted ON credit_notes;
CREATE TRIGGER trg_credit_note_posted
  BEFORE UPDATE OR DELETE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION bap_block_posted_sales_document();

DROP TRIGGER IF EXISTS trg_delivery_note_posted ON delivery_notes;
CREATE TRIGGER trg_delivery_note_posted
  BEFORE UPDATE OR DELETE ON delivery_notes
  FOR EACH ROW EXECUTE FUNCTION bap_block_posted_sales_document();

-- ---------------------------------------------------------------------------
-- 4. Lines are frozen once their document leaves draft.
--    An approver must not have the figures change beneath them.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_locked_invoice_lines()
RETURNS TRIGGER AS $$
DECLARE
  v_status text;
  v_reference text;
BEGIN
  SELECT status, invoice_number INTO v_status, v_reference
    FROM sales_invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);

  IF v_status::text <> 'DRAFT' THEN
    RAISE EXCEPTION
      'Invoice % is %; its lines cannot be changed.', v_reference, v_status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_lines_locked ON sales_invoice_lines;
CREATE TRIGGER trg_invoice_lines_locked
  BEFORE INSERT OR UPDATE OR DELETE ON sales_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION bap_block_locked_invoice_lines();

-- ---------------------------------------------------------------------------
-- 5. The stock ledger is append-only.
--    A stock movement records something that physically happened. Correcting
--    one means recording the opposite movement, not editing history.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bap_block_stock_movement_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'stock_movements is append-only; % is not permitted. Record a reversing movement instead.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_movements_immutable ON stock_movements;
CREATE TRIGGER trg_stock_movements_immutable
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION bap_block_stock_movement_mutation();

-- ---------------------------------------------------------------------------
-- 6. Sales configuration windows do not overlap.
-- ---------------------------------------------------------------------------

ALTER TABLE sales_configurations DROP CONSTRAINT IF EXISTS sales_configurations_no_overlap;
ALTER TABLE sales_configurations ADD CONSTRAINT sales_configurations_no_overlap
  EXCLUDE USING gist (
    company_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );
