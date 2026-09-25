/**
 * Code 128 (set B) — the barcode on pen and batch labels (DAILY_ENTRY_UX:
 * "QR optional"; scan to select without typing). Set B covers printable
 * ASCII, which every pen name and batch code is. Any phone camera scanner,
 * and the browser's own BarcodeDetector, reads it.
 *
 * Each symbol is six alternating bar/space widths summing to 11 modules; the
 * stop symbol is seven summing to 13. `assertTable()` checks that, so a
 * mistyped pattern fails loudly instead of printing labels nobody can read.
 */

const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

export function assertTable(): void {
  if (PATTERNS.length !== 107) throw new Error('Code 128 table must have 107 symbols.');
  const seen = new Set<string>();
  PATTERNS.forEach((p, i) => {
    const width = [...p].reduce((s, d) => s + Number(d), 0);
    if (width !== (i === STOP ? 13 : 11)) throw new Error(`Code 128 symbol ${i} is ${width} modules wide.`);
    if (seen.has(p)) throw new Error(`Code 128 symbol ${i} repeats another.`);
    seen.add(p);
  });
}

/** Bar/space module widths for `text`, quiet zones not included. */
export function code128(text: string): number[] {
  const values: number[] = [START_B];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error(`"${ch}" cannot be printed in a Code 128 label.`);
    values.push(code - 32);
  }
  const checksum = values.reduce((sum, value, i) => sum + value * (i === 0 ? 1 : i), 0) % 103;
  values.push(checksum, STOP);
  return values.flatMap((v) => [...PATTERNS[v]!].map(Number));
}
