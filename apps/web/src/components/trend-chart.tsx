'use client';

import { useId, useMemo, useState } from 'react';

/**
 * A single-series trend chart — line/area or bars.
 *
 * Deliberately ONE series per chart. Egg production runs around 6,000/day and
 * mortality around 15/day; putting both on one plot would need two y-scales,
 * which is the single most misleading thing a chart can do — the crossing point
 * of the two lines would be an artefact of the scales chosen, not a fact about
 * the farm. Two charts, each honest about its own magnitude.
 *
 * With one series, colour carries no identity: the title names the measure. So
 * no legend, and the hue is free to be tonal (green for output, red for loss).
 *
 * Hand-rolled SVG rather than a charting library — this is one form, and a
 * dependency for it would outweigh it.
 */

export interface Point {
  date: string;
  value: number;
}

const PAD = { top: 12, right: 8, bottom: 22, left: 40 };
const W = 560;
const H = 180;

export function TrendChart({
  points,
  kind = 'line',
  tone = 'brand',
  valueLabel,
  format = 'plain',
}: {
  points: Point[];
  kind?: 'line' | 'bar';
  tone?: 'brand' | 'danger';
  valueLabel: string;
  /*
   * A NAME, not a formatting function.
   *
   * Callers are server components, and React cannot serialise a function across
   * that boundary — passing one fails the whole page with "Functions cannot be
   * passed directly to Client Components". Naming the format keeps the choice
   * with the caller and the implementation on this side of the line.
   */
  format?: 'plain' | 'naira';
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const formatValue = (value: number) =>
    format === 'naira'
      ? `₦${value.toLocaleString('en-NG')}`
      : value.toLocaleString('en-NG');

  const colour = tone === 'danger' ? 'var(--error-500)' : 'var(--brand-600)';
  const colourStrong = tone === 'danger' ? 'var(--error-700)' : 'var(--brand-700)';

  const { scaleX, scaleY, ticks, max } = useMemo(() => {
    const values = points.map((p) => p.value);
    const rawMax = Math.max(...values, 1);
    // Round the top of the scale up to something a person would choose, so the
    // gridline labels are readable numbers rather than 6,237.
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax)));
    const niceMax = Math.ceil(rawMax / (magnitude / 2)) * (magnitude / 2);

    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    return {
      max: niceMax,
      scaleX: (index: number) =>
        PAD.left +
        (points.length === 1 ? plotW / 2 : (index / (points.length - 1)) * plotW),
      scaleY: (value: number) => PAD.top + plotH - (value / niceMax) * plotH,
      ticks: [0, niceMax / 2, niceMax],
    };
  }, [points]);

  if (points.length === 0) return null;

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(i)} ${scaleY(p.value)}`)
    .join(' ');

  const areaPath = `${linePath} L ${scaleX(points.length - 1)} ${H - PAD.bottom} L ${scaleX(0)} ${
    H - PAD.bottom
  } Z`;

  const barSlot = (W - PAD.left - PAD.right) / points.length;
  const barWidth = Math.max(3, barSlot - 3); // ~2–3px surface gap between bars

  const active = hover === null ? null : points[hover];

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        // Scale uniformly. `preserveAspectRatio="none"` would stretch the
        // viewBox to the container width and distort the axis labels with it —
        // the text was coming out horizontally smeared. Sizing lives in CSS
        // because `height="auto"` is not a valid SVG attribute length.
        style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible' }}
        role="img"
        aria-label={`${valueLabel} over the last ${points.length} days`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - rect.left) / rect.width;
          const x = ratio * W;
          const index = Math.round(((x - PAD.left) / (W - PAD.left - PAD.right)) * (points.length - 1));
          setHover(Math.min(points.length - 1, Math.max(0, index)));
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colour} stopOpacity="0.16" />
            <stop offset="100%" stopColor={colour} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Gridlines and value axis — recessive by design; they orient, they
            are not the content. */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={scaleY(tick)}
              y2={scaleY(tick)}
              stroke="var(--gray-200)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 8}
              y={scaleY(tick) + 3.5}
              textAnchor="end"
              fontSize="10"
              fill="var(--gray-400)"
            >
              {compact(tick)}
            </text>
          </g>
        ))}

        {kind === 'line' ? (
          <>
            <path d={areaPath} fill={`url(#${gradientId})`} />
            <path
              d={linePath}
              fill="none"
              stroke={colour}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : (
          points.map((point, index) => (
            <rect
              key={point.date}
              x={PAD.left + index * barSlot + (barSlot - barWidth) / 2}
              y={scaleY(point.value)}
              width={barWidth}
              height={Math.max(1, H - PAD.bottom - scaleY(point.value))}
              rx="2"
              fill={colour}
              opacity={hover === null || hover === index ? 1 : 0.45}
            />
          ))
        )}

        {/* Hover crosshair and marker */}
        {hover !== null && active ? (
          <>
            <line
              x1={scaleX(hover)}
              x2={scaleX(hover)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--gray-300)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {kind === 'line' ? (
              <circle
                cx={scaleX(hover)}
                cy={scaleY(active.value)}
                r="4.5"
                fill={colourStrong}
                stroke="var(--surface)"
                strokeWidth="2"
              />
            ) : null}
          </>
        ) : null}

        {/* Only the first, middle and last dates are labelled — a label under
            every bar is noise at this width. */}
        {[0, Math.floor(points.length / 2), points.length - 1].map((index) => (
          <text
            key={index}
            x={scaleX(index)}
            y={H - 6}
            textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
            fontSize="10"
            fill="var(--gray-400)"
          >
            {shortDate(points[index]!.date)}
          </text>
        ))}
      </svg>

      {hover !== null && active ? (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: `${(scaleX(hover) / W) * 100}%`,
            transform: 'translate(-50%, -100%)',
            background: 'var(--gray-900)',
            color: '#fff',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 10px',
            fontSize: 12,
            lineHeight: 1.35,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 2,
          }}
        >
          <div style={{ opacity: 0.7 }}>{longDate(active.date)}</div>
          <div style={{ fontWeight: 600 }}>
            {formatValue(active.value)} {valueLabel}
          </div>
        </div>
      ) : null}

      {/* Text alternative: the same figures, reachable without seeing colour. */}
      <table className="sr-only">
        <caption>{valueLabel} by day</caption>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <th scope="row">{longDate(point.date)}</th>
              <td>{formatValue(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="sr-only">Highest value in range: {formatValue(max)}</span>
    </div>
  );
}

function compact(value: number): string {
  if (value >= 1000) return `${(value / 1000).toLocaleString('en-NG')}k`;
  return value.toLocaleString('en-NG');
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
