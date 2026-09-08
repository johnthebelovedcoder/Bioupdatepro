/**
 * A role code, the way a person should read it.
 *
 * The one place this transform happens — it used to be four separate copies
 * (`user-menu.tsx`, `invite-worker.tsx`, `join/[token]/page.tsx`,
 * `settings-form.tsx`), three of which agreed and one of which did not: the
 * one behind `invite-worker.tsx`'s own `humanRole` looked up a role's label
 * from a curated list of six roles and fell back to the RAW CODE, unchanged,
 * for the other fourteen this system actually seeds — `SNAIL_SUPERVISOR`,
 * `FARM_ACCOUNTANT`, `TREASURY_OFFICER` and the rest, shown verbatim on the
 * Staff & roles people table and the role×section permission matrix, the two
 * screens an administrator actually uses to manage who can do what.
 *
 * A short, fixed list of acronyms is upper-cased whole rather than
 * title-cased letter by letter — "CFO" and "AP Officer" read as intended;
 * the generic transform alone would produce "Cfo" and "Ap Officer".
 */
const ACRONYMS = new Set(['cfo', 'ap', 'ar', 'qa']);

export function humanRole(code: string): string {
  return code
    .toLowerCase()
    .split('_')
    .map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}
