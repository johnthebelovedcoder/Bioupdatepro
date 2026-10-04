-- The balance cutover to the approved five-digit chart restates a poultry
-- cohort's earlier rearing cost into the account of its stage on the cutover
-- day. Rows before the chart held cost by stage carry no account; this is
-- where each cohort's untagged cost sits afterwards.
ALTER TABLE livestock_groups ADD COLUMN rearing_home_account TEXT;
