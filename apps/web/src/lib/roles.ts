/**
 * A role code, the way a person should read it.
 *
 * The one place this transform happens — it used to be duplicated in the
 * user menu, invitation screen, join screen, and settings form. A generic
 * transform keeps every supported role readable without a second label list
 * that can drift from the API's role catalogue.
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
