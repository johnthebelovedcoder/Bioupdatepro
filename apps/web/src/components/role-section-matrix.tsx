'use client';

import { setRoleSectionAccess } from '@/app/(app)/admin/roles/actions';
import { sectionsFor, type Section, type RoleSectionOverride } from '@/lib/permissions';
import { humanRole } from './invite-worker';

const SECTION_LABELS: Record<Section, string> = {
  dashboard: 'Dashboard',
  livestock: 'Livestock',
  recording: 'Recording',
  trade: 'Trade',
  inventory: 'Inventory',
  money: 'Money',
  ledger: 'Ledger',
  approvals: 'Approvals',
  staff: 'Staff',
  settings: 'Settings',
};

/**
 * One cell per (role, section): what the sidebar shows today, and a click to
 * change it (US-897-035).
 *
 * A cell with no override shows the hardcoded default from `permissions.ts`
 * — computed here with the same `sectionsFor` the sidebar itself calls, so
 * this table can never claim a default the sidebar does not actually use.
 * An override is marked with `*` so it is visible at a glance which cells an
 * admin has actually touched versus which are still just the shipped
 * default.
 */
export function RoleSectionMatrix({
  roles,
  sections,
  overrides,
  canEdit,
}: {
  roles: readonly string[];
  sections: readonly Section[];
  overrides: readonly RoleSectionOverride[];
  canEdit: boolean;
}) {
  const overrideFor = (role: string, section: Section) =>
    overrides.find((o) => o.role === role && o.section === section);

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th style={{ width: 200 }}>Role</th>
            {sections.map((section) => (
              <th key={section} style={{ textAlign: 'center' }}>
                {SECTION_LABELS[section]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => {
            const defaults = sectionsFor([role]);
            return (
              <tr key={role}>
                <td className="strong">{humanRole(role)}</td>
                {sections.map((section) => {
                  const override = overrideFor(role, section);
                  const enabled = override ? override.enabled : defaults.has(section);
                  const label = override
                    ? `${enabled ? 'Visible' : 'Hidden'} (overridden) — click to ${enabled ? 'hide' : 'show'} ${humanRole(role)}'s ${SECTION_LABELS[section]}`
                    : `${enabled ? 'Visible' : 'Hidden'} (default) — click to ${enabled ? 'hide' : 'show'} ${humanRole(role)}'s ${SECTION_LABELS[section]}`;

                  if (!canEdit) {
                    return (
                      <td key={section} style={{ textAlign: 'center' }} title={label}>
                        <span className={`badge ${enabled ? 'badge-success' : ''}`}>
                          {enabled ? '✓' : '—'}
                          {override ? '*' : ''}
                        </span>
                      </td>
                    );
                  }

                  return (
                    <td key={section} style={{ textAlign: 'center' }}>
                      <form action={setRoleSectionAccess.bind(null, role, section, !enabled)}>
                        <button
                          type="submit"
                          className={`badge ${enabled ? 'badge-success' : ''}`}
                          title={label}
                        >
                          {enabled ? '✓' : '—'}
                          {override ? '*' : ''}
                        </button>
                      </form>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="card-footer">
        <span className="faint">
          {canEdit
            ? 'Click a cell to toggle it. * marks a role/section overridden away from its default.'
            : 'Read-only — ask a CFO, farm manager or system admin to change these. * marks a role/section overridden away from its default.'}
        </span>
      </div>
    </div>
  );
}
