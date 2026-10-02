import Link from 'next/link';
import { getFarmConfig, hasSavedSettings } from '@/lib/farm-config.server';
import { getContext } from '@/lib/org';
import { subscribedModules } from '@/lib/modules';
import { getFeeding, getGroups, getProduction } from '@/lib/operations';
import { getCostCentres, getStockItems } from '@/lib/masters';
import { getTaxSetup } from '@/lib/tax';
import { getPostingControlStatus } from '@/lib/controls';
import { getTeamSize } from '@/app/(app)/staff/actions';
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
  const [config, context] = await Promise.all([
    getFarmConfig(),
    getContext().catch(() => null),
  ]);
  const farmName = context?.company?.name ?? config.organisation.name;
  const modules = subscribedModules(config.modules);

  // Has anything actually been recorded yet? The steps tick themselves off, so
  // somebody returning mid-setup can see where they got to.
  //
  // Each step below used to just be `done={false}` — a checklist that could
  // never actually be checked off no matter what you did on the farm. Every
  // signal here reads something real instead:
  const groups = (
    await Promise.all(modules.map((module) => getGroups(module.key)))
  ).flat();
  const hasPopulations = groups.length > 0;

  // A big `days` window rather than "recent" — this asks "has the round ever
  // been walked", not "was it walked this month". Feed is checked alongside
  // production because a round with only mortality/health recorded that day
  // would otherwise never show up in production rows at all.
  const ROUND_EVER_DAYS = 3650;
  const [production, feeding] = await Promise.all([
    Promise.all(modules.map((module) => getProduction(module.key, ROUND_EVER_DAYS))),
    Promise.all(modules.map((module) => getFeeding(module.key, ROUND_EVER_DAYS))),
  ]);
  const hasWalkedRound = [...production.flat(), ...feeding.flat()].length > 0;

  // A real per-company record now (see `CompanyConfig`'s own schema
  // comment) — this asks whether the FARM has ever saved a setting, not
  // whether this particular browser has, which is what the cookie this
  // replaced could actually answer.
  const hasConfiguredSettings = await hasSavedSettings();
  const [stockItems, costCentres, taxSetup, chartStatus] = await Promise.all([
    getStockItems(),
    getCostCentres(),
    getTaxSetup(),
    getPostingControlStatus(),
  ]);
  const hasInventoryItems = stockItems.length > 0;
  const hasCostCentres = costCentres.some((centre) => centre.active);
  const hasTaxSetup = taxSetup.ok && taxSetup.data.configured;
  const chartReady = chartStatus.ok && chartStatus.data.targetChart.ready;

  // A headcount, not the roster `listPeople` returns — that endpoint is
  // restricted to the roles that manage staff, so asking it here silently
  // told every other role their fully-staffed farm still needed a first
  // invitation.
  const hasTeam = (await getTeamSize()) > 1;
  const steps = [hasPopulations, hasWalkedRound, hasInventoryItems, hasCostCentres, hasConfiguredSettings, chartReady, hasTaxSetup, hasTeam];
  const completeSteps = steps.filter(Boolean).length;

  return (
    <>
      <PageHeader
        title={`Welcome to ${farmName}`}
        subtitle={`${completeSteps} of ${steps.length} setup steps complete · pick up where you left off`}
      />

      <div className="stack">
        <Card>
          <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
            <span className="list-icon tone-success">
              <IconCheckCircle size={16} />
            </span>
            <div>
              <div style={{ fontWeight: 500 }}>Your farm workspace is ready</div>
              <p className="muted" style={{ fontSize: 14, margin: '4px 0 0' }}>
                Initial books, cost centres and open periods are available. Review account mappings and reconcile historical balances with Finance before migrating opening balances.
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
          done={hasWalkedRound}
          number={2}
          title="Walk the daily round"
          body="Once a day, record what each house ate, produced and lost. It works with no signal — anything you record is kept on the phone and sent when the signal returns."
          href={`/m/${modules[0]?.key ?? 'poultry'}/records`}
          cta="Open the daily round"
        />

        <Step
          done={hasInventoryItems}
          number={3}
          title="Add the items you keep in store"
          body="Set up feed, medicine and packaging so receipts and issues can update the right stock records."
          href="/items"
          cta="Set up store items"
        />

        <Step
          done={hasCostCentres}
          number={4}
          title="Cost centres are available"
          body="Cost centres show where money is earned and spent. Review the supplied list and add any missing areas before entering costed transactions."
          href="/admin/cost-centres"
          cta="Review cost centres"
        />

        <Step
          done={hasConfiguredSettings}
          number={5}
          title="Set the farm up your way"
          body="Feed lead times, what counts as an unusual death, which language your workers see. The warnings you get are only as good as these."
          href="/settings"
          cta="Open setup"
        />

        <Step
          done={chartReady}
          number={6}
          title="Review approved chart readiness"
          body="Check the target account mapping and its blockers. This check does not approve or migrate historical balances; those need reconciliation evidence and Finance sign-off."
          href="/ledger/chart"
          cta="Review chart readiness"
        />

        <Step
          done={hasTaxSetup}
          number={7}
          title="Set your tax policy before invoicing"
          body="Tax treatment and rates depend on your registration and Finance guidance. Review the configured policy and active codes before raising taxable documents."
          href="/ledger/tax"
          cta="Review tax setup"
        />

        <Step
          done={hasTeam}
          number={8}
          title="Invite your team"
          body="You are the only person who can see this farm right now. Bring in whoever else needs to record a round, approve an order or see the books."
          href="/staff"
          cta="Invite someone"
        />

        {/*
          The honest half.

          Stated here rather than discovered at the till. Tax rates carry
          statutory consequences and approval limits decide who can commit the
          farm's money — neither is something this product should guess at, so
          neither has been.
        */}
        {!hasTaxSetup ? (
          <Card title="Before your first taxable invoice">
            <p className="muted" style={{ fontSize: 14, margin: 0 }}>
              Tax codes, rates and approval limits depend on your organisation&apos;s policy. They are not guessed for you. Confirm them with Finance before issuing a taxable invoice; farm records can still be entered while setup is in progress.
            </p>
          </Card>
        ) : null}

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
