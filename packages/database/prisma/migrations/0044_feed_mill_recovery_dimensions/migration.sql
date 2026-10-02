-- One Feed Mill recovery account carries every species. Preserve analysis on
-- the journal line (species and formula); batch remains the source document,
-- and work centre is the cost centre on the line.
ALTER TABLE journal_lines
  ADD COLUMN species_key TEXT;

CREATE INDEX journal_lines_species_period_idx
  ON journal_lines(company_id, species_key, financial_period_id);

-- Migration 0036 created species-specific feed-recovery accounts. They are
-- no longer used for new postings; retain their historical journals/balances
-- unchanged while preventing further posting to them.
UPDATE gl_accounts
SET active = FALSE, is_posting_account = FALSE
WHERE account_number IN ('219831', '219832');
