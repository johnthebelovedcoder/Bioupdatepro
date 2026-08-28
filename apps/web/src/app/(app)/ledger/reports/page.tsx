import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Reports — BioAssetPro' };

const REPORTS = [
  {
    href: '/ledger/trial-balance',
    title: 'Trial balance',
    body: 'Every account and its balance. Posted journal lines only.',
  },
  {
    href: '/ledger/profit-loss',
    title: 'Profit & loss',
    body: 'Revenue, cost of sales and operating expense, for a period.',
  },
  {
    href: '/ledger/balance-sheet',
    title: 'Balance sheet',
    body: 'What the company owns, owes, and is worth, as at today.',
  },
  {
    href: '/ledger/cash-flow',
    title: 'Cash flow',
    body: 'Where the cash moved, for one period, indirect method.',
  },
  {
    href: '/ledger/fixed-assets',
    title: 'Fixed assets',
    body: 'The asset register, and depreciation runs.',
  },
  {
    href: '/ledger/kpis',
    title: 'KPIs',
    body: 'Nine measures management uses to make decisions, each computed or explicitly not.',
  },
  {
    href: '/ledger/ar-ageing',
    title: 'AR ageing',
    body: 'Who owes the company, and how overdue it is.',
  },
  {
    href: '/ledger/ap-ageing',
    title: 'AP ageing',
    body: 'Who the company owes, and how overdue it is.',
  },
  {
    href: '/ledger/journals',
    title: 'Journal entries',
    body: 'Every posting in the ledger, whichever module raised it.',
  },
  {
    href: '/ledger/audit',
    title: 'Audit trail',
    body: 'Who did what, when, and what changed.',
  },
];

/**
 * An index of every report this company can run — a plain in-app list, not a
 * database-driven catalogue. Nothing in the codebase consumes a
 * metadata-configurable report definition today, so building one would be
 * scope invented ahead of any need; this is exactly what the client asked
 * for, one place to find every report.
 */
export default function ReportsPage() {
  return (
    <div className="stack">
      <PageHeader title="Reports" subtitle="Every report this company can run, in one place" />

      <Tabs />

      <div className="stat-grid">
        {REPORTS.map((report) => (
          <Link
            key={report.href}
            href={report.href}
            className="stat"
            style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
          >
            <div className="stat-label">{report.title}</div>
            <p className="faint" style={{ marginTop: 'var(--sp-2)', fontSize: 13 }}>
              {report.body}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
