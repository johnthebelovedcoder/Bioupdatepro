'use client';

import { useState } from 'react';
import { buildSummary, shareLinks, type SummaryInput } from '@/lib/share';
import { Sheet } from './sheet';

/**
 * Sending the day's figures to whoever is not on the farm.
 *
 * Shows the message before it goes anywhere. That matters more than it looks:
 * the person sending it is accountable for the numbers, and a share button that
 * fires off text they have not read is a good way to send yesterday's figures to
 * an owner and be asked about them an hour later.
 */
export function ShareSummary({ summary }: { summary: SummaryInput }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const text = buildSummary(summary);
  const links = shareLinks(text);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access can be refused. The text is on screen and selectable,
      // which is the fallback that needs no permission.
    }
  }

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Send today&apos;s summary
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Send today's summary"
        footer={
          <div className="row" style={{ gap: 'var(--sp-3)', justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Close
            </button>
            <a
              className="btn btn-primary"
              href={links.whatsapp}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open WhatsApp
            </a>
          </div>
        }
      >
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="muted" style={{ fontSize: 14 }}>
            This opens the app with the message already written. Nothing is sent until you
            choose who it goes to and press send there.
          </p>

          <pre
            style={{
              margin: 0,
              padding: 'var(--sp-4)',
              background: 'var(--gray-50)',
              border: '1px solid var(--gray-200)',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              // The summary can be long, and a preview that pushes its own
              // buttons off the sheet is a preview nobody can act on.
              maxHeight: '38vh',
              overflowY: 'auto',
            }}
          >
            {text}
          </pre>

          <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <a className="btn" href={links.sms}>
              SMS
            </a>
            <a className="btn" href={links.email}>
              Email
            </a>
            <button type="button" className="btn" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
