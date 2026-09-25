import { api } from '@/lib/api';
import { getGroups } from '@/lib/operations';
import { subscribedModules } from '@/lib/modules';
import { Barcode } from '@/components/barcode';
import { PrintButton } from '@/components/print-button';
import { PageHeader } from '@/components/ui';

export const metadata = { title: 'Labels — BioAssetPro' };

interface Pen {
  id: string;
  code: string;
  name: string;
  active: boolean;
  farmName: string;
}

/**
 * Printable labels for every house and every live batch (DAILY_ENTRY_UX:
 * scan to select without typing). Stick a house label on the door and a
 * batch label on its card; in the daily round, Scan jumps to that stop.
 * A house label carries the name the round shows; a batch label its code.
 */
export default async function LabelsPage() {
  const pens = (await api<Pen[]>('/masters/pens')).filter((pen) => pen.active);
  const batches = (
    await Promise.all(subscribedModules().map((module) => getGroups(module.key).catch(() => [])))
  )
    .flat()
    .filter((batch) => batch.status === 'ACTIVE');

  return (
    <>
      <PageHeader title="Labels" subtitle="Print, cut out, and stick on house doors and batch cards" actions={<PrintButton />} />
      <section className="label-sheet">
        {pens.map((pen) => (
          <figure key={pen.id} className="label">
            <figcaption>
              House · {pen.farmName}
            </figcaption>
            <Barcode value={pen.name} />
          </figure>
        ))}
        {batches.map((batch) => (
          <figure key={batch.id} className="label">
            <figcaption>
              Batch · {batch.breed} · {batch.house}
            </figcaption>
            <Barcode value={batch.code} />
          </figure>
        ))}
      </section>
      <style>{`
        .label-sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
        .label { margin: 0; padding: 10px; border: 1px dashed var(--border, #ccc); background: #fff; color: #000; break-inside: avoid; }
        .label figcaption { font-size: 12px; margin-bottom: 6px; }
        @media print {
          nav, header, aside, .page-header-actions, .no-print { display: none !important; }
          .label-sheet { grid-template-columns: repeat(3, 1fr); }
        }
      `}</style>
    </>
  );
}
