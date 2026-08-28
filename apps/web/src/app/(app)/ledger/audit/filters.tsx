'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { FilterPanel } from '@/components/filter-panel';
import { IconSearch } from '@/components/icons';

export function AuditFilters({
  modules,
  selected,
}: {
  modules: string[];
  selected: { module: string; search: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete('page');
    router.push(`?${next.toString()}`);
  }

  return (
    <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
      <FilterPanel>
        <label className="field">
          Module
          <select
            value={selected.module}
            onChange={(event) => update({ module: event.target.value })}
          >
            <option value="">All modules</option>
            {modules.map((module) => (
              <option key={module} value={module}>
                {module}
              </option>
            ))}
          </select>
        </label>
      </FilterPanel>

      <form
        className="table-search"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          update({ search: String(data.get('search') ?? '') });
        }}
      >
        <IconSearch size={16} />
        <input
          name="search"
          defaultValue={selected.search}
          placeholder="Entity, comment or transaction id"
        />
      </form>
    </div>
  );
}
