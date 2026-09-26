import { api } from '@/lib/api';
import type { SessionUser } from '@/lib/session';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { AcknowledgeException, IncubatorForm, ReadingForm, StandardForm } from '@/components/incubation-log-forms';

interface IncubatorRow {
  id: string;
  code: string;
  name: string;
  capacityEggs: number;
  active: boolean;
  eggsIn: number;
  free: number;
}

export const metadata = { title: 'Incubation log — BioAssetPro' };

interface Standard {
  minTemperatureC: string;
  maxTemperatureC: string;
  minHumidityPercent: string;
  maxHumidityPercent: string;
  readingIntervalHours: number;
}

interface BatchRow {
  id: string;
  code: string;
  eggBatch: string;
  incubator: string | null;
  setOn: string;
  setQuantity: number;
  readings: number;
  lastReadAt: string | null;
  overdue: boolean;
  hoursSinceReading: number;
  missedReadings: number;
  openExceptions: number;
  candling: { on: string; fertile: number | null; clear: number | null; deadInShell: number | null } | null;
}

interface Reading {
  id: string;
  kind: 'ENVIRONMENT' | 'CANDLING';
  readAt: string;
  temperatureC: string | null;
  humidityPercent: string | null;
  turned: boolean | null;
  fertileCount: number | null;
  clearCount: number | null;
  deadInShellCount: number | null;
  note: string | null;
  exceptions: string[];
  recordedById: string;
  acknowledgedAt: string | null;
  actionTaken: string | null;
}

const SUPERVISORS = ['FARM_MANAGER', 'POULTRY_SUPERVISOR', 'PRODUCTION_SUPERVISOR', 'PRODUCTION_LEAD', 'QA_OFFICER', 'CFO'];
const time = (iso: string) => new Date(iso).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The incubation log (FR-LIFE-04, SOP-EGG-04, P-EGG-05): every batch in the
 * setter, its readings and candling, what is overdue, and the exceptions a
 * supervisor must acknowledge before the batch can be hatched.
 */
export default async function IncubationLogPage() {
  const [overview, standard, me, incubators] = await Promise.all([
    api<{ standard: { readingIntervalHours: number } | null; batches: BatchRow[] }>('/poultry/incubation-log'),
    api<Standard | null>('/poultry/incubation-log/standard'),
    api<SessionUser>('/auth/me'),
    api<IncubatorRow[]>('/poultry/incubation-log/incubators').catch(() => [] as IncubatorRow[]),
  ]);
  const details = await Promise.all(
    overview.batches.map((b) => api<{ readings: Reading[] }>(`/poultry/incubation-log/batches/${b.id}`).catch(() => ({ readings: [] as Reading[] }))),
  );
  const canAcknowledge = me.roles.some((r) => SUPERVISORS.includes(r));
  const overdue = overview.batches.filter((b) => b.overdue).length;
  const open = overview.batches.reduce((s, b) => s + b.openExceptions, 0);

  return (
    <>
      <PageHeader title="Incubation log" subtitle="Setter readings, candling, and what needs a supervisor before the hatch" />
      <Tabs />
      <div className="stack">
        {overdue || open ? (
          <div className="notice notice-warning">
            {overdue ? `${overdue} batch${overdue === 1 ? ' has a reading' : 'es have readings'} overdue. ` : ''}
            {open ? `${open} exception${open === 1 ? '' : 's'} waiting for a supervisor; a batch cannot hatch until they are acknowledged.` : ''}
          </div>
        ) : null}

        {overview.batches.length === 0 ? (
          <Card title="Nothing in the setter">
            <p className="faint" style={{ margin: 0 }}>
              Batches appear here once eggs are set, until they hatch.
            </p>
          </Card>
        ) : (
          overview.batches.map((b, i) => (
            <Card
              key={b.id}
              title={`${b.code} — ${b.setQuantity.toLocaleString('en-NG')} eggs${b.incubator ? ` in ${b.incubator}` : ''}`}
              subtitle={`Set ${b.setOn} from ${b.eggBatch}. ${b.readings} reading${b.readings === 1 ? '' : 's'}${
                b.lastReadAt ? `, last ${b.hoursSinceReading} h ago` : ''
              }${b.missedReadings ? `, ${b.missedReadings} missed` : ''}.${
                b.candling ? ` Candled: ${b.candling.fertile ?? 0} fertile, ${b.candling.clear ?? 0} clear, ${b.candling.deadInShell ?? 0} dead in shell.` : ''
              }`}
            >
              <div className="stack" style={{ gap: 'var(--sp-3)' }}>
                <div className="row" style={{ gap: 'var(--sp-2)' }}>
                  {b.overdue ? <span className="badge badge-danger">reading overdue</span> : <span className="badge badge-success">readings up to date</span>}
                  {b.openExceptions ? <span className="badge badge-warning">{b.openExceptions} to acknowledge</span> : null}
                </div>
                <ReadingForm batchId={b.id} />
                {details[i]!.readings.length ? (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th style={{ width: 170 }}>Taken</th>
                          <th>Reading</th>
                          <th style={{ width: 260 }}>Exception</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details[i]!.readings.slice(0, 20).map((r) => (
                          <tr key={r.id}>
                            <td className="num" style={{ textAlign: 'left' }}>
                              {time(r.readAt)}
                            </td>
                            <td>
                              {r.kind === 'ENVIRONMENT'
                                ? [r.temperatureC ? `${r.temperatureC}°C` : null, r.humidityPercent ? `${r.humidityPercent}%` : null, r.turned === false ? 'not turned' : r.turned ? 'turned' : null]
                                    .filter(Boolean)
                                    .join(' · ')
                                : `Candling: ${r.fertileCount} fertile, ${r.clearCount} clear, ${r.deadInShellCount} dead in shell`}
                              {r.note ? <div className="faint">{r.note}</div> : null}
                            </td>
                            <td>
                              {r.exceptions.length ? (
                                <>
                                  <div>{r.exceptions.join(' ')}</div>
                                  {r.acknowledgedAt ? (
                                    <div className="faint">Acknowledged: {r.actionTaken}</div>
                                  ) : canAcknowledge && r.recordedById !== me.userId ? (
                                    <AcknowledgeException id={r.id} />
                                  ) : (
                                    <div className="faint">waiting for a supervisor</div>
                                  )}
                                </>
                              ) : (
                                <span className="faint">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            </Card>
          ))
        )}

        <Card
          title="Incubators"
          subtitle={incubators.length ? 'Eggs are set only into a registered incubator with room for them' : 'None registered — the incubator on a set is free text and capacity is not checked'}
          padded={false}
        >
          {incubators.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Code</th>
                    <th>Name</th>
                    <th className="right">Holds</th>
                    <th className="right">In it now</th>
                    <th className="right">Room</th>
                  </tr>
                </thead>
                <tbody>
                  {incubators.map((i) => (
                    <tr key={i.id}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        {i.code}
                      </td>
                      <td>
                        {i.name}
                        {!i.active ? <span className="badge" style={{ marginLeft: 6 }}>out of use</span> : null}
                      </td>
                      <td className="num right">{i.capacityEggs.toLocaleString('en-NG')}</td>
                      <td className="num right">{i.eggsIn.toLocaleString('en-NG')}</td>
                      <td className="num right">{i.free.toLocaleString('en-NG')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {canAcknowledge ? (
            <div style={{ padding: 'var(--sp-4)' }}>
              <IncubatorForm />
            </div>
          ) : null}
        </Card>

        <Card
          title="Incubation standard"
          subtitle={standard ? 'Readings outside these ranges are exceptions' : 'Not set — readings are logged but not checked, and none can be overdue'}
        >
          {canAcknowledge ? (
            <StandardForm current={standard} />
          ) : (
            <p className="faint" style={{ margin: 0 }}>
              {standard
                ? `${standard.minTemperatureC}–${standard.maxTemperatureC}°C, ${standard.minHumidityPercent}–${standard.maxHumidityPercent}% humidity, a reading every ${standard.readingIntervalHours} hours.`
                : 'A supervisor sets it.'}
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
