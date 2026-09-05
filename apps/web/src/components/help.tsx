'use client';

import { useState } from 'react';

/**
 * The little "?" that explains a word.
 *
 * This product puts accounting and husbandry vocabulary in front of people who
 * did not choose either — hen-day, FCR, work in progress, withdrawal period.
 * The alternative to explaining them is a farmer who reads "FCR 1.72" and takes
 * nothing from it, which makes the figure worse than absent: it occupies the
 * space where something useful could have been.
 *
 * Built as a click-to-open popover rather than a CSS `title` or hover card, for
 * three reasons that all come from where this is used:
 *
 *   · Hover does not exist on a phone, and the phone is the primary device.
 *   · `title` cannot be read by touch at all, and screen readers treat it
 *     inconsistently.
 *   · A farmer standing in a pen needs it to stay open while they read it.
 *
 * The button carries the explanation as its accessible name, so a screen reader
 * announces the meaning without the popover ever being opened.
 */
export function Help({ term, children }: { term: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="help-wrap">
      <button
        type="button"
        className="help-trigger"
        aria-expanded={open}
        aria-label={`What ${term} means`}
        onClick={() => setOpen((current) => !current)}
      >
        ?
      </button>

      {open ? (
        <>
          {/*
            A full-screen catcher so a tap anywhere dismisses it. Ordinary
            outside-click listeners miss taps on a phone's address bar and leave
            the popover stuck open over the thing it was explaining.
          */}
          <span
            className="help-catcher"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <span className="help-bubble" role="note">
            <strong style={{ display: 'block', marginBottom: 4 }}>{term}</strong>
            {children}
          </span>
        </>
      ) : null}
    </span>
  );
}

/**
 * The farm vocabulary, defined once.
 *
 * Kept together rather than written at each use so the same term cannot be
 * explained two different ways on two screens — which is how a glossary starts
 * contradicting itself.
 *
 * Deliberately plain data (a term and a body string), not pre-built
 * `<Help>...</Help>` elements. The earlier version built the JSX once here and
 * exported it as `TERMS.henDay` etc. for callers to drop straight in — which
 * looked right and type-checked, but silently rendered nothing wherever a
 * Server Component (most pages in this app) was the caller: a plain object
 * whose values happen to contain JSX referencing a Client Component doesn't
 * reliably survive that boundary the way importing and using the Client
 * Component directly does. `HelpTerm` below is that direct usage — the shape
 * every call site should reach for instead of building `<Help>` itself.
 */
export const TERMS = {
  henDay: {
    term: 'Hen-day',
    body: 'Eggs laid as a share of the birds alive that day. 90% means nine eggs from every ten birds. It is the fairest way to compare houses of different sizes.',
  },
  fcr: {
    term: 'FCR',
    body: 'Feed conversion ratio — kilograms of feed for each kilogram of weight gained. Lower is better. 1.7 means 1.7 kg of feed produced 1 kg of bird.',
  },
  workInProgress: {
    term: 'Work in progress',
    body: 'What the animals currently alive have cost so far — feed, treatment and the stock itself. It is not an expense yet and not revenue; it becomes cost of sale when they are sold.',
  },
  withdrawalPeriod: {
    term: 'Withdrawal period',
    body: 'After some treatments, eggs or meat cannot be sold for a number of days. That number comes off the product label — we do not know it for you.',
  },
  mortalityRate: {
    term: 'Mortality',
    body: 'Deaths so far as a share of the number placed. It only ever rises, because it counts the whole life of the population.',
  },
  costPerAnimal: {
    term: 'Cost per animal',
    body: 'Everything spent on the population divided by how many are still alive. It rises when animals are lost — which is the point: the survivors carry the cost of the ones that died.',
  },
  feedRunway: {
    term: 'Runway',
    body: 'How many days the feed in the store will last at the rate it is being used now.',
  },
  variance: {
    term: 'Variance',
    body: 'A figure that does not match what comparable populations did. It is a discrepancy to look into, not an accusation — over-feeding, spillage, a broken feeder and a miscount all look the same from here.',
  },
} as const;

/**
 * The one way to reach a `TERMS` entry from anywhere, including a Server
 * Component — see the note on `TERMS` above for why this indirection exists.
 */
export function HelpTerm({ k }: { k: keyof typeof TERMS }) {
  const entry = TERMS[k];
  return <Help term={entry.term}>{entry.body}</Help>;
}
