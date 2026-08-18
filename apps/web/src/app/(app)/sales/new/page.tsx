import { getCustomers, getSellableItems } from '@/lib/trade';
import { getGroups } from '@/lib/operations';
import { getFarmConfig } from '@/lib/farm-config.server';
import { RecordSale } from '@/components/record-sale';

export const metadata = { title: 'Record a sale — BioAssetPro' };

/**
 * Not scoped to a species module.
 *
 * A farm sells eggs and snails on the same afternoon to the same buyer. Making
 * someone switch module halfway through writing a receipt would be absurd, so
 * the sale screen sees every population the farm has.
 */
export default async function NewSalePage() {
  const [products, customers, poultry, snails, config] = await Promise.all([
    getSellableItems(),
    getCustomers(),
    getGroups('poultry'),
    getGroups('snail'),
    getFarmConfig(),
  ]);

  return (
    <RecordSale
      products={products}
      customers={customers}
      batches={[...poultry, ...snails]}
      today={new Date().toISOString().slice(0, 10)}
      allowWalkIn={config.sales.allowWalkIn}
      defaultTermsDays={config.sales.defaultPaymentTermsDays}
      creditLimitKobo={config.sales.creditLimitKobo}
    />
  );
}
