import { api } from '@/lib/api';
import { Card, PageHeader, Stat } from '@/components/ui';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Posting rules — BioAssetPro' };

interface Side {
  key: string;
  code: string | null;
  name: string;
  ledgerFlag: 'CONTROL' | 'GENERAL' | 'NO_JOURNAL';
  flagConflict: string | null;
  resolved: boolean;
  /** Set when a dedicated service resolves this key instead of this table. */
  dynamicResolution: string | null;
}

interface Rule {
  ruleId: string;
  module: string;
  cycle: string;
  trigger: string;
  sourceDocument: string;
  measurementBasis: string;
  makerRole: string;
  approverRole: string;
  status: string;
  debit: Side | null;
  credit: Side | null;
  postsNothing: boolean;
}

/**
 * The 86 posting rules, as a person can read them.
 *
 * §66.4 makes adding a rule a controlled act needing a Finance Controller's
 * approval, which is impossible if the rules live only in a database and a
 * spreadsheet. This is the register: what every business event does to the
 * ledger, which accounts it touches, who raises it and who approves it.
 *
 * It also makes the gaps visible — carefully. A posting key that resolves to
 * an expression rather than an account — "Species BA acquisition GL" — is not
 * always a decision still owed: for some of them, a dedicated service (the
 * biological-asset ledger, an item's own configured account, the reversal
 * engine) already resolves the real account per transaction and posts through
 * the one shared engine directly, just not through this declarative table.
 * Those are shown as resolved elsewhere, not blocked, because reporting them
 * as blocked would tell a Finance Controller the client owes an answer for
 * something the software already handles. What remains genuinely blocked is
 * either a real open question or a module that is not built yet.
 */
export default async function PostingRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string }>;
}) {
  const [rules, query] = await Promise.all([
    api<Rule[]>('/posting-control/rules').catch(() => [] as Rule[]),
    searchParams,
  ]);

  const cycles = [...new Set(rules.map((rule) => rule.cycle))].sort();
  const shown = query.cycle ? rules.filter((rule) => rule.cycle === query.cycle) : rules;

  const posting = rules.filter((rule) => !rule.postsNothing);
  const unresolvedSide = (side: Side | null) => side && !side.resolved && !side.dynamicResolution;
  const blocked = posting.filter((rule) => unresolvedSide(rule.debit) || unresolvedSide(rule.credit));
  const dedicated = posting.filter(
    (rule) =>
      !blocked.includes(rule) &&
      ((rule.debit && !rule.debit.resolved) || (rule.credit && !rule.credit.resolved)),
  );

  return (
    <>
      <PageHeader
        title="Posting rules"
        subtitle="What every business event does to the ledger — Consolidated Reference §66"
      />

      <div className="stack">
        <Tabs />

        <Card>
          <p style={{ fontSize: 15, lineHeight: 1.6 }}>
            Nobody types a GL account into this system. An approved business event names two
            posting keys, and the keys resolve to accounts through the posting chart. That is
            what makes a posting rule something a Finance Controller can approve, date and
            retire — rather than something only a developer can change.
          </p>
        </Card>

        <div className="stat-grid">
          <Stat label="Rules" value={String(rules.length)} hint="from the approved workbook" />
          <Stat label="That post" value={String(posting.length)} hint="the rest are approval-only" />
          <Stat
            label="Resolved elsewhere"
            value={String(dedicated.length)}
            hint="a dedicated service posts these, not this table"
          />
          <Stat
            label="Blocked"
            value={String(blocked.length)}
            goodWhen="down"
            hint="no account, and no dedicated resolver either"
          />
          <Stat label="Cycles" value={String(cycles.length)} />
        </div>

        {dedicated.length > 0 ? (
          <div className="notice notice-info">
            {dedicated.length} rules post through dedicated application code instead of this
            table — the biological-asset ledger, an item&rsquo;s own configured account, or the
            reversal engine already resolves the real account per transaction. Marked{' '}
            <span className="badge">resolved elsewhere</span> below rather than blocked.
          </div>
        ) : null}

        {blocked.length > 0 ? (
          <div className="notice notice-warning">
            {blocked.length} rules cannot post yet, through this table or any dedicated service.
            Each one names a posting key that resolves to a description rather than an account —
            &ldquo;Species BA acquisition GL&rdquo;, &ldquo;Configured revenue GL&rdquo; — or
            belongs to a module (feed mill, processing, ABC costing) that is not built yet.
            Somebody has to decide which account each means, or the module has to exist first;
            the system refuses rather than choosing on the farm&rsquo;s behalf.
          </div>
        ) : null}

        <Card title={query.cycle ? `${query.cycle} rules` : 'All rules'} padded={false}>
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Rule</th>
                  <th style={{ width: 110 }}>Cycle</th>
                  <th>Event</th>
                  <th style={{ width: 260 }}>Debit</th>
                  <th style={{ width: 260 }}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((rule) => (
                  <tr key={rule.ruleId}>
                    <td className="num strong" style={{ textAlign: 'left' }}>
                      {rule.ruleId}
                    </td>
                    <td className="faint">{rule.cycle}</td>
                    <td>
                      {rule.trigger}
                      <div className="faint">
                        {rule.sourceDocument} · {rule.makerRole} → {rule.approverRole}
                      </div>
                    </td>
                    {rule.postsNothing ? (
                      <td colSpan={2}>
                        <span className="badge">no journal</span>
                        <div className="faint">
                          Approval and audit only. Nothing reaches the accounts.
                        </div>
                      </td>
                    ) : (
                      <>
                        <SideCell side={rule.debit} />
                        <SideCell side={rule.credit} />
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

function SideCell({ side }: { side: Side | null }) {
  if (!side) return <td className="faint">—</td>;
  return (
    <td>
      <span className="num">{side.resolved ? side.code : '—'}</span>{' '}
      <span className={side.resolved ? '' : 'faint'}>{side.name}</span>
      <div>
        {side.ledgerFlag === 'CONTROL' ? (
          <span className="badge badge-accent" title="Subledger and system postings only">
            control
          </span>
        ) : side.ledgerFlag === 'GENERAL' ? (
          <span className="badge">journal allowed</span>
        ) : (
          <span className="badge">no journal</span>
        )}
        {!side.resolved && side.dynamicResolution ? (
          <span
            className="badge badge-success"
            style={{ marginLeft: 'var(--sp-2)' }}
            title={side.dynamicResolution}
          >
            resolved elsewhere
          </span>
        ) : null}
        {!side.resolved && !side.dynamicResolution ? (
          <span className="badge badge-warning" style={{ marginLeft: 'var(--sp-2)' }}>
            not an account yet
          </span>
        ) : null}
        {/* The workbook marks this row GENERAL and the account CONTROL
            elsewhere. Shown so a controller is not told they may journal an
            account the system will refuse. */}
        {side.flagConflict ? (
          <div className="faint">
            workbook says {side.flagConflict.toLowerCase()} on this row — raised with the client
          </div>
        ) : null}
      </div>
    </td>
  );
}
