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
  const after = (payKobo - balance).toString();
  return (
    <div className="notice notice-warning" role="status">
      {balance < 0n
        ? `The books already show this account overdrawn by ${formatNaira((-balance).toString())}. This payment of ${formatNaira(payKobo.toString())} takes it to ${formatNaira(after)} overdrawn.`
        : `The books show ${formatNaira(balance.toString())} in this account and this payment is ${formatNaira(payKobo.toString())}. Paying it leaves the account ${formatNaira(after)} overdrawn.`}
    </div>
  );
}
