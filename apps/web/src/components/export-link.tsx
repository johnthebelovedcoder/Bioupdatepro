/**
 * "Export CSV" for a report. A plain link to the same-origin export route, so
 * it works without script and the browser handles the download itself.
 * Amounts in the file are integer kobo, exactly as the ledger holds them.
 */
export function ExportLink({
  report,
  filters = {},
}: {
  report: 'trial-balance' | 'profit-loss' | 'balance-sheet' | 'cash-flow' | 'ar-ageing' | 'ap-ageing';
  filters?: Record<string, string | undefined | null>;
}) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value) query.set(name, value);
  }
  const href = `/api/export/${report}${query.size ? `?${query}` : ''}`;
  return (
    <a className="btn" href={href} download title="Amounts are in kobo, as the ledger holds them">
      Export CSV
    </a>
  );
}
