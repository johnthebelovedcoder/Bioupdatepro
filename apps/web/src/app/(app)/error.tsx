'use client';

import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui';

/**
 * What a screen shows when it cannot load, instead of a raw application error.
 *
 * The usual cause is a screen the person's role does not cover: the API refuses
 * the data, and a page that did not expect the refusal used to fall over with an
 * HTTP 500 and no explanation. The server's own wording is only available in
 * development; in production the message is withheld, so this speaks in general
 * terms and offers a way out.
 */
export default function ScreenError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const refused = /This needs one of/i.test(error.message);
  return (
    <>
      <PageHeader
        title={refused ? 'That screen is not yours' : 'This screen could not load'}
        subtitle={refused ? 'Your role does not cover it' : 'Nothing has been lost'}
      />
      <Card>
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="muted" style={{ fontSize: 14, margin: 0 }}>
            {refused
              ? `${error.message} Nothing is wrong with your account — this part of the farm is handled by somebody with a different role.`
              : 'It may be that your role does not cover this screen, or that something went wrong on our side. Try again; if it keeps happening, ask whoever manages the farm.'}
          </p>
          <div className="row" style={{ gap: 'var(--sp-3)' }}>
            <Link className="btn btn-primary" href="/">
              Go to the dashboard
            </Link>
            {refused ? null : (
              <button type="button" className="btn" onClick={() => reset()}>
                Try again
              </button>
            )}
          </div>
          {error.digest ? <p className="faint" style={{ fontSize: 12, margin: 0 }}>Reference {error.digest}</p> : null}
        </div>
      </Card>
    </>
  );
}
