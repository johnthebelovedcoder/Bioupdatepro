import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui';

export const metadata = { title: 'Not your screen — BioAssetPro' };

/**
 * Shown when somebody opens a page their role does not cover.
 *
 * The alternative was what this replaced: a raw "Application error", because
 * the page fetched data the API correctly refused and nothing caught the
 * refusal. Protecting the data and telling the person nothing are different
 * problems, and only one of them was solved.
 *
 * The tone matters. This is not a warning and not an accusation — most people
 * arriving here followed a link from an alert, or a bookmark from when they had
 * a different job. It says what happened, who to ask, and where to go instead.
 */
export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;

  return (
    <>
      <PageHeader title="That screen is not yours" subtitle="Your role does not cover it" />

      <Card>
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="muted" style={{ fontSize: 14, margin: 0 }}>
            {from ? (
              <>
                You do not have access to <code>{from}</code>.
              </>
            ) : (
              'You do not have access to that page.'
            )}{' '}
            Nothing is wrong with your account — this part of the farm is handled by somebody
            with a different role.
          </p>

          <p className="muted" style={{ fontSize: 14, margin: 0 }}>
            If you need it, ask whoever manages the farm to change what your account can
            reach.
          </p>

          <div className="row" style={{ gap: 'var(--sp-3)' }}>
            <Link className="btn btn-primary" href="/">
              Go to the dashboard
            </Link>
          </div>
        </div>
      </Card>
    </>
  );
}
