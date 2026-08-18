'use client';

import { useRouter, useSearchParams } from 'next/navigation';

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
    <div className="card">
      <form
        className="card-body grid-auto"
        style={{ alignItems: 'end' }}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          update({ search: String(data.get('search') ?? '') });
        }}
      >
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

        <label className="field">
          Search
          <input
            name="search"
            defaultValue={selected.search}
            placeholder="Entity, comment or transaction id"
          />
        </label>

        <button type="submit" className="btn">
          Apply
        </button>
      </form>
    </div>
  );
}
