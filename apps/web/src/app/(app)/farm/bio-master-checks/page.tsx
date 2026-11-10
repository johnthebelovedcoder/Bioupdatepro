import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { signOffBioMasterChecks } from './actions';

export const metadata = { title: 'BIO_MASTER_CHECKS — BioAssetPro' };

interface BioMasterChecks {
  checklist: 'BIO_MASTER_CHECKS';
  ready: boolean;
  groupsChecked: number;
  issues: Array<{ groupCode: string; speciesKey: string; reason: string }>;
}

export default async function BioMasterChecksPage({ searchParams }: { searchParams: Promise<{ signed?: string }> }) {
  const { signed } = await searchParams;
  let result: BioMasterChecks | null = null;
  let error: string | null = null;
  try {
    result = await api<BioMasterChecks>('/operations/bio-master-checks');
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not load biological master checks.';
  }

  return (
    <div className="stack">
      <PageHeader
        title="BIO_MASTER_CHECKS"
        subtitle="Supervisor review of approved species and breeds, stage and age, source evidence, and approved weighing history"
      />
      <Tabs />
      {error ? <div className="notice notice-error">{error}</div> : null}
      {signed ? <div className="notice notice-success">BIO_MASTER_CHECKS sign-off recorded in the audit history.</div> : null}
      {result ? (
        <Card
          title={`${result.ready ? 'Ready' : 'Needs attention'} · ${result.groupsChecked} active groups`}
          padded={false}
          action={<span className={`badge ${result.ready ? 'badge-success' : 'badge-danger'}`}>{result.ready ? 'PASS' : `${result.issues.length} issues`}</span>}
        >
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Group</th><th>Check to resolve</th></tr></thead>
              <tbody>
                {result.issues.length === 0 ? (
                  <tr><td colSpan={2} className="faint">All active groups pass the current checklist.</td></tr>
                ) : result.issues.map((issue, index) => (
                  <tr key={`${issue.groupCode}-${issue.reason}-${index}`}>
                    <td className="strong" style={{ textAlign: 'left' }}><Link href={`/m/${issue.speciesKey}/${issue.speciesKey === 'snail' ? 'cohorts' : 'flocks'}/${encodeURIComponent(issue.groupCode)}`}>{issue.groupCode}</Link></td>
                    <td>{issue.reason.replaceAll('_', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="faint" style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
            This checklist reports data quality; use the batch profile and approved master records to correct exceptions.
          </p>
          <form action={signOffBioMasterChecks} className="stack" style={{ padding: 'var(--sp-3) var(--sp-4)', gap: 'var(--sp-3)' }}>
            <label className="field">Release label<input name="releaseLabel" placeholder="e.g. Farm production release 2026-11" required /></label>
            {!result.ready ? <label className="field">Accepted exceptions (required to sign off with issues)<textarea name="exceptionsAcknowledged" rows={3} /></label> : null}
            <button className="btn btn-primary" type="submit">Record supervisor sign-off</button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
