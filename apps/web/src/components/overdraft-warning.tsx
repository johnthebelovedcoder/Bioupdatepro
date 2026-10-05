import { formatNaira } from '@/lib/money';

/**
 * Said before a payment is sent for approval: what the account holds in the books
 * against what is about to leave it. A warning, not a block — the ledger balance
 * can lag the bank, and an approver may know a deposit is on its way.
 */
export function OverdraftWarning({
  balanceKobo,
  payKobo,
}: {
  balanceKobo: string | undefined;
  payKobo: bigint;
}) {
  if (balanceKobo === undefined || payKobo <= 0n) return null;
  const balance = BigInt(balanceKobo);
  if (payKobo <= balance) return null;
  return (
    <div className="notice notice-warning" role="status">
      The books show {formatNaira(balance.toString())} in this account and this payment is{' '}
      {formatNaira(payKobo.toString())}. Paying it leaves the account{' '}
      {formatNaira((payKobo - balance).toString())} overdrawn.
    </div>
  );
}
