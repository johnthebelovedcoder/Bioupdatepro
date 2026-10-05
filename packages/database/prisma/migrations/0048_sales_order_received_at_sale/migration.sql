-- A sale recorded as paid on the spot keeps how it was paid, so the receipt for
-- its invoice can be prepared with the right method instead of being forgotten.
ALTER TABLE sales_orders ADD COLUMN received_at_sale_method "ReceiptMethod";
