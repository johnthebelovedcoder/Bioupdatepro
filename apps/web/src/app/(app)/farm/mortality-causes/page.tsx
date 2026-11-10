import { api } from '@/lib/api';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { addMortalityCause, toggleMortalityCause } from './actions';

export const metadata = { title: 'Mortality causes — BioAssetPro' };

interface Cause { id: string; speciesKey: string; code: string; label: string; active: boolean }
const SPECIES = ['poultry', 'snail', 'fish', 'dairy', 'pig', 'goat', 'rabbit'];

export default async function MortalityCausesPage({ searchParams }: { searchParams: Promise<{ species?: string }> }) {
  const params = await searchParams;
  const species = SPECIES.includes(params.species ?? '') ? params.species! : 'poultry';
  const causes = await api<Cause[]>(`/operations/mortality-causes?species=${encodeURIComponent(species)}`);
  return (
    <div className="stack">
      <PageHeader title="Mortality causes" subtitle="Active causes are enforced by the API and stored as codes on each mortality record" />
      <Tabs />
      <Card title="Cause master">
        <form className="row" style={{ gap: 'var(--sp-3)', alignItems: 'end', paddingBottom: 'var(--sp-4)' }}>
          <label className="field">Species<select name="species" defaultValue={species}>{SPECIES.map((key) => <option key={key} value={key}>{key}</option>)}</select></label>
          <button className="btn" type="submit">Show</button>
        </form>
        <div className="table-wrap">
          <table className="data"><thead><tr><th>Code</th><th>Cause</th><th>Status</th><th /></tr></thead>
            <tbody>{causes.map((cause) => <tr key={cause.id}>
              <td className="num strong">{cause.code}</td><td>{cause.label}</td><td>{cause.active ? 'Active' : 'Inactive'}</td>
              <td><form action={toggleMortalityCause}><input type="hidden" name="id" value={cause.id} /><input type="hidden" name="speciesKey" value={species} /><input type="hidden" name="active" value={String(!cause.active)} /><button className="btn btn-sm" type="submit">{cause.active ? 'Deactivate' : 'Activate'}</button></form></td>
            </tr>)}</tbody>
          </table>
        </div>
      </Card>
      <Card title="Add cause">
        <form action={addMortalityCause} className="row" style={{ gap: 'var(--sp-3)', alignItems: 'end' }}>
          <input type="hidden" name="speciesKey" value={species} />
          <label className="field">Cause code<input name="code" pattern="[A-Za-z0-9_]{2,50}" required /></label>
          <label className="field">Label<input name="label" maxLength={100} required /></label>
          <button className="btn btn-primary" type="submit">Add approved cause</button>
        </form>
      </Card>
    </div>
  );
}
