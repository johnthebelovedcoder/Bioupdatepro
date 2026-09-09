import { getStockItems } from '@/lib/masters';
import { getSuppliers } from '@/lib/trade';
import { getFeedRunway } from '@/lib/alerts';
import { getFarmConfig } from '@/lib/farm-config.server';
import { RecordPurchase } from '@/components/record-purchase';

export const metadata = { title: 'Buy supplies — BioAssetPro' };

export default async function NewPurchasePage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string }>;
}) {
  const [items, suppliers, config, query] = await Promise.all([
    getStockItems(),
    getSuppliers(),
    getFarmConfig(),
    searchParams,
  ]);

  /*
   * Arriving from a "feed is running out" alert, suggest how much to buy.
   *
   * Derived, not invented: current daily use × long enough to cover the
   * supplier's lead time, the farm's buffer, and a fortnight of cover on top.
   * Rounded to whole bags because feed is not sold by the kilo. The farmer can
   * change it — the point is that they should not have to work out the sum
   * standing in the feed store.
   */
  let suggestedQuantity: number | undefined;
  const suggested = query.item
    ? items.find((item) => item.code === query.item || item.name === query.item)
    : undefined;

  if (suggested?.category === 'Feed') {
    const runway = await getFeedRunway(config);
    const feed = runway.find((entry) => entry.item === suggested.name);
    if (feed && feed.dailyUse > 0) {
      const cover = config.feed.supplierLeadDays + config.feed.runwayBufferDays + 14;
      const needed = Math.max(0, feed.dailyUse * cover - suggested.onHand);
      // Feed comes in 25kg bags; ordering 1,347 kg is not a thing you can do.
      suggestedQuantity = Math.ceil(needed / 25) * 25;
    }
  }

  return (
    <RecordPurchase
      items={items}
      suppliers={suppliers}
      today={new Date().toISOString().slice(0, 10)}
      {...(query.item ? { suggestedItem: query.item } : {})}
      {...(suggestedQuantity ? { suggestedQuantity } : {})}
    />
  );
}
