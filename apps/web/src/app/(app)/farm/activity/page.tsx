import { getActivityLog } from '@/lib/demo-ops';
import { formatDate } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import {
  IconAlert,
  IconCart,
  IconCheckCircle,
  IconClipboard,
  IconEgg,
  IconFeed,
  IconTag,
} from '@/components/icons';
import { Tabs, FARM_TABS } from '@/components/tabs';

export const metadata = { title: 'Daily activity — BioAssetPro' };

/**
 * The farm's operational history, in one timeline.
 *
 * Every module and every kind of event in one place, because "what happened on
 * Tuesday" is not a question anyone asks per species. This is a view over the
 * event log rather than a table of its own — which is exactly why the event log
 * is one table and not ten.
 */
export default async function ActivityPage() {
  const days = await getActivityLog();

  return (
    <>
      <PageHeader
        title="Daily activity"
        subtitle="Everything that happened, most recent first"
      />

      <Tabs tabs={FARM_TABS} />

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
                  <span className={`list-icon ${toneFor(entry.kind)}`}>
                    <Icon size={16} />
                  </span>
                  <div className="list-main">
                    <div className="list-title">{entry.title}</div>
                    <div className="list-sub">{entry.detail}</div>
                    <div className="faint">{entry.by}</div>
                  </div>
                  <span className="list-time">{entry.time}</span>
                </div>
              );
            })}
          </Card>
        ))}

        <Card>
          <p className="muted" style={{ fontSize: 14 }}>
            This will be a view over the farm event log — the same records the daily round
            writes — filtered by farm, house, population, worker or date. Nothing here is
            stored yet.
          </p>
        </Card>
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
    case 'mortality':
      return IconAlert;
    case 'sale':
      return IconTag;
    case 'purchase':
      return IconCart;
    case 'health':
      return IconCheckCircle;
    default:
      return IconClipboard;
  }
}

function toneFor(kind: string): string {
  switch (kind) {
    case 'mortality':
      return 'tone-danger';
    case 'production':
    case 'sale':
      return 'tone-success';
    case 'health':
    case 'purchase':
      return 'tone-info';
    default:
      return '';
  }
}
