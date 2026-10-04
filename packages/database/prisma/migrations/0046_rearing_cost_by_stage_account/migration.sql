-- Poultry rearing cost on the approved five-digit chart is held in the
-- biological asset account of the flock's stage on the day it is posted
-- (16032 immature, 16042 mature). Record the account each feed and treatment
-- posting used, and which accounts each relief took its amount from. Rows
-- before this change have neither and stay on the species' single account.
ALTER TABLE feed_issues ADD COLUMN rearing_account_number TEXT;
ALTER TABLE treatment_records ADD COLUMN rearing_account_number TEXT;

CREATE TABLE livestock_rearing_relief_splits (
  id UUID NOT NULL,
  relief_id UUID NOT NULL,
  account_number TEXT NOT NULL,
  amount_kobo BIGINT NOT NULL,
  CONSTRAINT livestock_rearing_relief_splits_pkey PRIMARY KEY (id),
  CONSTRAINT livestock_rearing_relief_splits_positive CHECK (amount_kobo > 0),
  CONSTRAINT livestock_rearing_relief_splits_relief_fkey
    FOREIGN KEY (relief_id) REFERENCES livestock_rearing_reliefs(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX livestock_rearing_relief_splits_relief_id_account_number_key
  ON livestock_rearing_relief_splits(relief_id, account_number);
