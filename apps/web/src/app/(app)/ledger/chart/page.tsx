import { getUnificationPreview } from '@/lib/controls';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { ChartUnificationForm } from '@/components/chart-unification-form';

export const metadata = { title: 'Six-digit chart — BioAssetPro' };

/**
 * Moving the farm's books to the client's six-digit chart.
 *
 * The page shows, before anything happens, every balance on the old chart and
 * where it will go — split by item and by species where the new chart splits
 * them — and what each sold item is taken to be. Nothing changes until a CFO
 * presses the button, and then it all changes together.
 */
export default async function ChartPage({ searchParams }: { searchParams: Promise<{ cutover?: string }> }) {
  const { cutover } = await searchParams;
  const preview = await getUnificationPreview(cutover);

  return (
    <>
      <PageHeader title="Six-digit chart" subtitle="Move the books from the four-digit chart to the client’s six-digit chart" />
      <Tabs />
      <div className="stack">
        {!preview.ok ? (
          <div className="notice notice-error">{preview.error}</div>
        ) : preview.data.chartVersion === 'SPEC' ? (
          <Card title="This farm is on the six-digit chart">
            <p style={{ fontSize: 14 }}>Everything posts to the six-digit accounts. There is nothing to move.</p>
          </Card>
        ) : !preview.data.cutoverDate ? (
          <div className="notice notice-warning">{preview.data.blockers.join(' ')}</div>
        ) : (
          <ChartUnificationForm initial={preview.data} />
        )}
      </div>
    </>
  );
}
