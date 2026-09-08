import { getActivityLog } from '@/lib/operations';
import { subscribedModules } from '@/lib/modules';
import { getFarmConfig } from '@/lib/farm-config.server';
import { formatDate } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import { IconCheckCircle, IconEgg, IconFeed } from '@/components/icons';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Daily activity — BioAssetPro' };

/**
 * The farm's operational history, in one timeline — feeding, production and
 * harvests, real, across every subscribed module.
 *
 * Sales, purchases and mortality are not in this timeline yet: sales and
 * purchases are still on their own fixtures elsewhere in this migration, and
 * there is no single real endpoint for mortality as dated events the way
 * feeding/production/harvest each have one (only a per-population 14-day
 * series, which would mean one request per population to assemble here).
 * Leaving them out is the honest choice until each has a real source —
 * showing three real kinds beats showing six where half are invented.
 */
export default async function ActivityPage() {
  const config = await getFarmConfig();
  const moduleKeys = subscribedModules(config.modules).map((module) => module.key);
  const days = await getActivityLog(moduleKeys);

  return (
    <>
      <PageHeader
        title="Daily activity"
        subtitle="Everything that happened, most recent first"
      />

      <Tabs />

      <div className="stack">
        {days.map((day) => (
          <Card
            key={day.date}
            title={formatDate(day.date)}
            subtitle={`${day.entries.length} ${day.entries.length === 1 ? 'entry' : 'entries'}`}
            padded={false}
          >
            {day.entries.map((entry) => {
              const Icon = iconFor(entry.kind);
              return (
                <div className="list-row" key={entry.id}>
                  <span className="list-icon">
                    <Icon size={16} />
                  </span>
                  <div className="list-main">
                    <div className="list-title">{entry.title}</div>
                    <div className="list-sub">{entry.detail}</div>
                  </div>
                </div>
              );
            })}
          </Card>
        ))}

        {days.length === 0 ? (
          <Card>
            <p className="muted" style={{ fontSize: 14 }}>
              Nothing recorded in the last two weeks.
            </p>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function iconFor(kind: string) {
  switch (kind) {
    case 'production':
      return IconEgg;
    case 'feed':
      return IconFeed;
    default:
      return IconCheckCircle;
  }
}
