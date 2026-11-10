import Link from 'next/link';
import { api } from '@/lib/api';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { PostingGroupAssignmentForm, EndPostingGroupAssignmentForm } from '@/components/posting-group-assignment-form';

export const metadata = { title: 'Posting groups — BioAssetPro' };

interface PostingGroup {
  id: string;
  application: string;
  postingGroup: string;
  masterType: string;
  description: string;
  status: string;
}

interface Assignment {
  id: string;
  masterType: string;
  masterId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  assignedBy: { fullName: string };
  approvedPostingGroup: PostingGroup;
}

export default async function PostingGroupsPage() {
  const [groups, assignments] = await Promise.all([
    api<PostingGroup[]>('/posting-control/posting-groups').catch(() => []),
    api<Assignment[]>('/posting-control/group-assignments').catch(() => []),
  ]);

  return (
    <>
      <PageHeader title="Posting groups" subtitle="Assign workbook posting groups to the master records that drive accounting" />
      <Tabs />
      <div className="stack">
        <Card title="Assign a group" subtitle="Finance-controlled and effective-dated">
          {groups.length ? (
            <PostingGroupAssignmentForm groups={groups} />
          ) : (
            <div className="notice notice-warning">
              The approved group register is not loaded yet. Load the approved posting rules from{' '}
              <Link href="/ledger/controls">Ledger → Controls</Link> first.
            </div>
          )}
        </Card>

        <Card title="Current and historical assignments" subtitle={`${assignments.length} assignment${assignments.length === 1 ? '' : 's'}`} padded={false}>
          {!assignments.length ? (
            <p className="faint" style={{ padding: 'var(--sp-5)' }}>No posting groups have been assigned to master records.</p>
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead><tr><th>Master record</th><th>Application / group</th><th>Effective</th><th>Assigned by</th><th>Change</th></tr></thead>
                <tbody>
                  {assignments.map((assignment) => {
                    const from = assignment.effectiveFrom.slice(0, 10);
                    return (
                      <tr key={assignment.id}>
                        <td>{assignment.masterType}<br /><span className="faint">{assignment.masterId}</span></td>
                        <td>{assignment.approvedPostingGroup.application}<br /><strong>{assignment.approvedPostingGroup.postingGroup}</strong></td>
                        <td>{from} – {assignment.effectiveTo?.slice(0, 10) ?? 'open'}</td>
                        <td>{assignment.assignedBy.fullName}</td>
                        <td>{assignment.status === 'Active' && !assignment.effectiveTo ? <EndPostingGroupAssignmentForm assignmentId={assignment.id} effectiveFrom={from} /> : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
