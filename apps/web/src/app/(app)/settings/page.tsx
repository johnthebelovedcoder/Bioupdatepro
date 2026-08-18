import { getFarmConfig } from '@/lib/farm-config.server';
import { SettingsForm } from '@/components/settings-form';

export const metadata = { title: 'Farm setup — BioAssetPro' };

/**
 * Every decision the system makes on the farm's behalf is set here.
 *
 * The page is thin on purpose: it reads the configuration and hands it to the
 * form. What matters is that the SAME `getFarmConfig()` is what the daily
 * round, the feed runway, the variance watch and the alerts all read, so a
 * setting changed here genuinely changes what those screens do rather than
 * being a control that reports its own state back to itself.
 */
export default async function SettingsPage() {
  const config = await getFarmConfig();
  return <SettingsForm config={config} />;
}
