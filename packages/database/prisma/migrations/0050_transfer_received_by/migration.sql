-- Who confirmed a stock transfer arrived. The receiver must not be the person who issued it
-- (unless the company allows self-approval), and the row now says who it was.
ALTER TABLE inventory_transfers ADD COLUMN received_by_id UUID;
