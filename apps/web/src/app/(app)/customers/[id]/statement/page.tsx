import { PartyStatement } from '@/components/party-statement';

export const metadata = { title: 'Statement — BioAssetPro' };

export default async function CustomerStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const [{ id }, { from, to }] = await Promise.all([params, searchParams]);
  return <PartyStatement kind="customer" id={id} from={from} to={to} />;
}
