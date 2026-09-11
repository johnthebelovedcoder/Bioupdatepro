import { getDelegations, getColleagues } from '@/lib/delegations';
import { formatDate } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { GrantDelegationForm } from '@/components/grant-delegation-form';
import { RevokeDelegationButton } from '@/components/revoke-delegation-button';
import { IconUsers } from '@/components/icons';

export const metadata = { title: 'Delegations — BioAssetPro' };

/**
 * §2 Delegation — the fix for a document permanently stuck because the sole
 * holder of a required role also raised it: maker-checker correctly refuses
 * their own approval, and with nobody else holding that role, nothing before
 * this screen could move it forward. `DelegationService` (create/revoke,
 * time-windowed, audited) has been real since it was built; this is its
 * first screen.
 *
 * A delegation lends authority, never identity — the delegate acts as
 * themselves, and Rule 4 still refuses them their own document even while
 * carrying somebody else's role.
 */
export default async function DelegationsPage() {
  const [delegations, colleagues, today] = await Promise.all([
    getDelegations(),
    getColleagues(),
    Promise.resolve(new Date().toISOString().slice(0, 10)),
  ]);

  const granted = delegations.filter((d) => d.direction === 'GRANTED');
  const received = delegations.filter((d) => d.direction === 'RECEIVED');
  const now = Date.now();
  const isCurrent = (d: (typeof delegations)[number]) =>
    d.active && new Date(d.startDate).getTime() <= now && new Date(d.endDate).getTime() >= now;

  return (
    <>
      <PageHeader
        title="Delegations"
        subtitle="Lend your approval authority to a colleague for a window, or see what has been lent to you"
        actions={<GrantDelegationForm colleagues={colleagues} today={today} />}
      />

      <Tabs />

      <div className="stack">
        <Card title="Granted by you" padded={false}>
          {granted.length === 0 ? (
            <EmptyState
              icon={<IconUsers size={22} />}
              title="You haven't delegated anything"
              body="If you are the only holder of a role and raise a document yourself, nobody can approve it — delegate your authority to a colleague to unblock it."
            />
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th>To</th>
                    <th style={{ width: 130 }}>Starts</th>
                    <th style={{ width: 130 }}>Ends</th>
                    <th>Reason</th>
                    <th style={{ width: 100 }}>Status</th>
                    <th style={{ width: 100 }}>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {granted.map((d) => (
                    <tr key={d.id}>
                      <td className="strong">{d.delegateName}</td>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {formatDate(d.startDate)}
                      </td>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {formatDate(d.endDate)}
                      </td>
                      <td>{d.reason}</td>
                      <td>
                        <span
                          className={`badge ${
                            !d.active ? '' : isCurrent(d) ? 'badge-success' : 'badge-warning'
                          }`}
                        >
                          {!d.active ? 'revoked' : isCurrent(d) ? 'active' : 'scheduled'}
                        </span>
                      </td>
                      <td>{d.active ? <RevokeDelegationButton delegationId={d.id} /> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Lent to you" padded={false}>
          {received.length === 0 ? (
            <EmptyState
              icon={<IconUsers size={22} />}
              title="Nobody has delegated to you"
              body="When a colleague lends you their authority, it shows here and their documents start reaching your approvals queue."
            />
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th>From</th>
                    <th style={{ width: 130 }}>Starts</th>
                    <th style={{ width: 130 }}>Ends</th>
                    <th>Reason</th>
                    <th style={{ width: 100 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {received.map((d) => (
                    <tr key={d.id}>
                      <td className="strong">{d.delegatorName}</td>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {formatDate(d.startDate)}
                      </td>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {formatDate(d.endDate)}
                      </td>
                      <td>{d.reason}</td>
                      <td>
                        <span
                          className={`badge ${
                            !d.active ? '' : isCurrent(d) ? 'badge-success' : 'badge-warning'
                          }`}
                        >
                          {!d.active ? 'revoked' : isCurrent(d) ? 'active' : 'scheduled'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <p className="muted" style={{ fontSize: 14 }}>
            A delegation lends authority, never identity — the delegate acts as themselves, and
            the audit trail always names both people. It never opens a way around Rule 4: someone
            carrying your authority still cannot approve anything they raised themselves.
          </p>
        </Card>
      </div>
    </>
  );
}
