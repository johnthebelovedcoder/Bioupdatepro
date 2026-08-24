import Link from 'next/link';
import { getFarmConfig } from '@/lib/farm-config.server';
import { getContext } from '@/lib/org';
import { subscribedModules } from '@/lib/modules';
import { getGroups } from '@/lib/operations';
import { Card, PageHeader } from '@/components/ui';
import { IconArrowRight, IconCheckCircle, IconClipboard } from '@/components/icons';

export const metadata = { title: 'Welcome — BioAssetPro' };

/**
 * The first screen after signing up.
 *
 * A new farm has nothing in it, and dropping somebody onto a dashboard of empty
 * charts is how a product gets closed in the first five minutes. So this says
 * what already exists, what to do first, and — the part most onboarding skips —
 * what is deliberately NOT set up yet, so nobody discovers a missing tax rate
 * at the moment they try to invoice.
 *
 * It is a real page rather than a modal tour: a farmer setting up will be
 * interrupted, and a tour that cannot be resumed has to be started again.
 */
export default async function WelcomePage() {
  // The company from the ledger, not the local default — this page greets
  // somebody by their farm's name moments after they typed it.
  const [config, context] = await Promise.all([getFarmConfig(), getContext().catch(() => null)]);
  const farmName = context?.company?.name ?? config.organisation.name;
  const modules = subscribedModules(config.modules);

  // Has anything actually been recorded yet? The steps tick themselves off, so
  // somebody returning mid-setup can see where they got to.
  const groups = (
    await Promise.all(modules.map((module) => getGroups(module.key)))
  ).flat();
  const hasPopulations = groups.length > 0;

  return (
    <>
      <PageHeader
        title={`Welcome to ${farmName}`}
        subtitle="Three steps and the farm is running"
      />

      <div className="stack">
        <Card>
          <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
            <span className="list-icon tone-success">
              <IconCheckCircle size={16} />
            </span>
            <div>
              <div style={{ fontWeight: 500 }}>Your books are ready</div>
              <p className="muted" style={{ fontSize: 14, margin: '4px 0 0' }}>
                A chart of accounts, cost centres and twelve open months have been set up.
                Every cost you record from here lands in them automatically.
              </p>
            </div>
          </div>
        </Card>

        <Step
          done={hasPopulations}
          number={1}
          title={`Add your first ${modules[0]?.terms.group.one ?? 'flock'}`}
          body={`Tell us what you are keeping and how many. Everything else — feed, deaths, treatments — is recorded against it.`}
          href={`/m/${modules[0]?.key ?? 'poultry'}/${modules[0]?.registerSlug ?? 'flocks'}/new`}
          cta={`Add a ${modules[0]?.terms.group.one ?? 'flock'}`}
        />

        <Step
          done={false}
          number={2}
          title="Walk the daily round"
          body="Once a day, record what each house ate, produced and lost. It works with no signal — anything you record is kept on the phone and sent when the signal returns."
          href={`/m/${modules[0]?.key ?? 'poultry'}/records`}
          cta="Open the daily round"
        />

        <Step
          done={false}
          number={3}
          title="Set the farm up your way"
          body="Feed lead times, what counts as an unusual death, which language your workers see. The warnings you get are only as good as these."
          href="/settings"
          cta="Open setup"
        />

        {/*
          The honest half.

          Stated here rather than discovered at the till. Tax rates carry
          statutory consequences and approval limits decide who can commit the
          farm's money — neither is something this product should guess at, so
          neither has been.
        */}
        <Card title="Not set up yet">
          <p className="muted" style={{ fontSize: 14, margin: 0 }}>
            Tax codes and rates, and the approval limits that decide who can sign off what,
            are left blank on purpose — they carry legal consequences and depend on your own
            accountant&apos;s advice. You can record everything on the farm without them. You
            will need them before you raise an invoice with VAT on it.
          </p>
        </Card>

        <div>
          <Link href="/" className="faint">
            Skip for now and go to the dashboard
          </Link>
        </div>
      </div>
    </>
  );
}

function Step({
  number,
  title,
  body,
  href,
  cta,
  done,
}: {
  number: number;
  title: string;
  body: string;
  href: string;
  cta: string;
  done: boolean;
}) {
  return (
    <Card>
      <div className="row" style={{ gap: 'var(--sp-4)', alignItems: 'flex-start' }}>
        <span className={`list-icon ${done ? 'tone-success' : ''}`}>
          {done ? <IconCheckCircle size={16} /> : <IconClipboard size={16} />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500 }}>
            {done ? <s>{title}</s> : title}
          </div>
          <p className="muted" style={{ fontSize: 14, margin: '4px 0 var(--sp-3)' }}>
            {body}
          </p>
          {!done ? (
            <Link className="btn" href={href}>
              {cta}
              <IconArrowRight size={15} />
            </Link>
          ) : (
            <span className="faint">Done</span>
          )}
        </div>
        <span className="faint" aria-hidden="true">
          {number}
        </span>
      </div>
    </Card>
  );
}
