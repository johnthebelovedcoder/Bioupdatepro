ALTER TABLE production_order_outputs
  ADD COLUMN is_immaterial_by_product BOOLEAN NOT NULL DEFAULT FALSE;
