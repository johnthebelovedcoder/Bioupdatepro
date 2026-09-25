import { code128 } from '@/lib/code128';

/**
 * A Code 128 barcode as SVG, with the text printed under it so a label is
 * still readable when there is no scanner. Black on white regardless of the
 * theme — a scanner needs the contrast, and labels are printed.
 */
export function Barcode({ value, height = 56, module = 2 }: { value: string; height?: number; module?: number }) {
  const widths = code128(value);
  const quiet = 10 * module;
  const total = widths.reduce((s, w) => s + w, 0) * module + quiet * 2;
  let x = quiet;
  const bars: Array<{ x: number; w: number }> = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w: w * module });
    x += w * module;
  });
  return (
    <svg
      role="img"
      aria-label={`Barcode ${value}`}
      viewBox={`0 0 ${total} ${height + 18}`}
      width={total}
      height={height + 18}
      style={{ background: '#fff', maxWidth: '100%' }}
    >
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="#000" />
      ))}
      <text x={total / 2} y={height + 14} textAnchor="middle" fontFamily="monospace" fontSize="13" fill="#000">
        {value}
      </text>
    </svg>
  );
}
