/**
 * Charts follow the dataviz method: 2px lines, hairline grid, one y-axis,
 * a legend for two or more series, a crosshair tooltip on lines, per-mark
 * tooltips on bars and cells, and a table twin for screen readers.
 */
import { motion, useReducedMotion } from 'motion/react';
import { scaleBand, scaleLinear, scaleTime } from 'd3-scale';
import { area as d3area, curveMonotoneX, line as d3line } from 'd3-shape';
import { extent, max as d3max, min as d3min } from 'd3-array';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SegmentLevel } from '../../lib/contract';
import { LEVEL_LABEL, fmtShortTime } from '../../lib/format';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (Math.abs(s.width - width) < 0.5 && Math.abs(s.height - height) < 0.5 ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export interface Point {
  t: number;
  v: number | null;
}

export interface Series {
  id: string;
  label: string;
  color: string;
  points: Point[];
  /** De-emphasised comparison line. */
  quiet?: boolean;
}

export interface Band {
  label: string;
  color: string;
  points: { t: number; lo: number; hi: number }[];
}

interface LineChartProps {
  series: Series[];
  band?: Band;
  height?: number;
  unit: string;
  formatValue?: (v: number) => string;
  formatTime?: (t: number) => string;
  yMin?: number;
  /** A vertical marker, e.g. "now" on a forecast. */
  marker?: { t: number; label: string };
  /** Points drawn as dots (forecast steps). */
  dots?: { t: number; v: number; color: string; label: string }[];
  title: string;
}

const M = { top: 22, right: 16, bottom: 26, left: 40 };

export function LineChart({
  series,
  band,
  height = 220,
  unit,
  formatValue = (v) => String(Math.round(v)),
  formatTime = (t) => fmtShortTime(t),
  yMin,
  marker,
  dots = [],
  title,
}: LineChartProps) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const reduce = useReducedMotion();
  const clipId = useId();

  const allT = useMemo(() => {
    const ts = series.flatMap((s) => s.points.map((p) => p.t));
    if (band) ts.push(...band.points.map((p) => p.t));
    ts.push(...dots.map((d) => d.t));
    return ts;
  }, [series, band, dots]);

  const allV = useMemo(() => {
    const vs: number[] = [];
    for (const s of series) for (const p of s.points) if (p.v !== null) vs.push(p.v);
    if (band) for (const p of band.points) vs.push(p.lo, p.hi);
    for (const d of dots) vs.push(d.v);
    return vs;
  }, [series, band, dots]);

  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  const [t0, t1] = extent(allT) as [number | undefined, number | undefined];
  const x = scaleTime()
    .domain([t0 ?? 0, t1 ?? 1])
    .range([0, innerW]);
  const vMax = d3max(allV) ?? 1;
  const vMin = yMin ?? Math.min(0, d3min(allV) ?? 0);
  const y = scaleLinear().domain([vMin, vMax * 1.08 || 1]).nice(4).range([innerH, 0]);

  const lineGen = d3line<Point>()
    .defined((p) => p.v !== null)
    .x((p) => x(p.t))
    .y((p) => y(p.v as number))
    .curve(curveMonotoneX);

  const bandPath = band
    ? d3area<{ t: number; lo: number; hi: number }>()
        .x((p) => x(p.t))
        .y0((p) => y(p.lo))
        .y1((p) => y(p.hi))
        .curve(curveMonotoneX)(band.points)
    : null;

  // crosshair snaps to the nearest timestamp of the first series
  const primary = series[0]?.points ?? [];
  const hoverT = hover !== null && primary.length ? primary[hover].t : null;

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    if (!primary.length) return;
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const t = x.invert(px).getTime();
    let best = 0;
    let bestD = Infinity;
    primary.forEach((p, i) => {
      const d = Math.abs(p.t - t);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best);
  }

  const ticksY = y.ticks(4);
  const ticksX = x.ticks(Math.max(2, Math.min(6, Math.floor(innerW / 110))));
  const ready = width > 0 && allT.length > 0;

  return (
    <div className="chart" ref={ref} style={{ height }}>
      {ready && (
        <svg width={width} height={height} role="img" aria-label={title}>
          <defs>
            <clipPath id={clipId}>
              <rect x={0} y={-4} width={innerW} height={innerH + 8} />
            </clipPath>
          </defs>
          <g transform={`translate(${M.left},${M.top})`}>
            {ticksY.map((tk) => (
              <g key={tk} transform={`translate(0,${y(tk)})`}>
                <line x1={0} x2={innerW} className="chart__grid" />
                <text x={-8} dy="0.32em" className="chart__tick" textAnchor="end">
                  {formatValue(tk)}
                </text>
              </g>
            ))}
            <line x1={0} x2={innerW} y1={innerH} y2={innerH} className="chart__axis" />
            {ticksX.map((tk) => (
              <text key={+tk} x={x(tk)} y={innerH + 18} className="chart__tick" textAnchor="middle">
                {formatTime(+tk)}
              </text>
            ))}
            <text x={-M.left + 2} y={-12} className="chart__unit">
              {unit}
            </text>
            <g clipPath={`url(#${clipId})`}>
              {bandPath && <path d={bandPath} fill={band!.color} opacity={0.14} />}
              {series.map((s) => (
                <motion.path
                  key={s.id}
                  d={lineGen(s.points) ?? ''}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={s.quiet ? 0.55 : 1}
                  initial={reduce ? false : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.7, ease: EASE_OUT }}
                />
              ))}
              {marker && (
                <g transform={`translate(${x(marker.t)},0)`}>
                  <line y1={0} y2={innerH} className="chart__marker" />
                  <text y={-2} x={4} className="chart__tick">
                    {marker.label}
                  </text>
                </g>
              )}
              {dots.map((d) => (
                <circle key={`${d.t}-${d.label}`} cx={x(d.t)} cy={y(d.v)} r={4.5} fill={d.color} stroke="var(--surface-1)" strokeWidth={2} />
              ))}
            </g>
            {hoverT !== null && (
              <g pointerEvents="none">
                <line x1={x(hoverT)} x2={x(hoverT)} y1={0} y2={innerH} className="chart__crosshair" />
                {series.map((s) => {
                  const p = s.points.find((q) => q.t === hoverT) ?? s.points[hover!];
                  return p && p.v !== null ? (
                    <circle key={s.id} cx={x(p.t)} cy={y(p.v)} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
                  ) : null;
                })}
              </g>
            )}
            <rect
              width={innerW}
              height={innerH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            />
          </g>
        </svg>
      )}
      {hoverT !== null && (
        <div
          className="chart__tooltip"
          style={{
            left: Math.min(width - 180, Math.max(0, M.left + x(hoverT) + 12)),
            top: M.top,
          }}
        >
          <p className="chart__tooltip-time">{formatTime(hoverT)}</p>
          {series.map((s) => {
            const p = s.points.find((q) => q.t === hoverT) ?? s.points[hover!];
            return (
              <p key={s.id} className="chart__tooltip-row">
                <span className="chart__key" style={{ background: s.color }} />
                <strong className="num">{p && p.v !== null ? formatValue(p.v) : '–'}</strong>
                <span>{s.label}</span>
              </p>
            );
          })}
        </div>
      )}
      {series.length > 1 && (
        <ul className="legend" aria-hidden="true">
          {series.map((s) => (
            <li key={s.id}>
              <span className="legend__line" style={{ background: s.color, opacity: s.quiet ? 0.55 : 1 }} />
              {s.label}
            </li>
          ))}
          {band && (
            <li>
              <span className="legend__band" style={{ background: band.color }} />
              {band.label}
            </li>
          )}
        </ul>
      )}
      <table className="visually-hidden">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Time</th>
            {series.map((s) => (
              <th key={s.id}>
                {s.label} ({unit})
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {primary.map((p, i) => (
            <tr key={p.t}>
              <td>{formatTime(p.t)}</td>
              {series.map((s) => (
                <td key={s.id}>{s.points[i]?.v != null ? formatValue(s.points[i].v as number) : '–'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Sparkline: a trend glyph beside a value that is shown elsewhere ----------

export function Sparkline({ points, color = 'var(--ink-2)', width = 88, height = 24 }: { points: Point[]; color?: string; width?: number; height?: number }) {
  const valid = points.filter((p) => p.v !== null) as { t: number; v: number }[];
  if (valid.length < 2) return <span className="spark spark--empty" style={{ width, height }} aria-hidden="true" />;
  const x = scaleLinear()
    .domain(extent(valid, (p) => p.t) as [number, number])
    .range([2, width - 4]);
  const [lo, hi] = extent(valid, (p) => p.v) as [number, number];
  const pad = Math.max(1, (hi - lo) * 0.15);
  const y = scaleLinear().domain([lo - pad, hi + pad]).range([height - 3, 3]);
  const d = d3line<{ t: number; v: number }>()
    .x((p) => x(p.t))
    .y((p) => y(p.v))
    .curve(curveMonotoneX)(valid);
  const last = valid[valid.length - 1];
  return (
    <svg className="spark" width={width} height={height} aria-hidden="true">
      <path d={d ?? ''} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <circle cx={x(last.t)} cy={y(last.v)} r={2.5} fill={color} />
    </svg>
  );
}

// ---------- Columns: one series by category ----------

export function Columns({
  data,
  height = 220,
  unit,
  formatValue,
  formatLabel,
  highlight,
  highlightLabel,
  title,
  color = 'var(--series-1)',
}: {
  data: { key: number; value: number | null }[];
  height?: number;
  unit: string;
  formatValue: (v: number) => string;
  formatLabel: (k: number) => string;
  highlight?: Set<number>;
  highlightLabel?: string;
  title: string;
  color?: string;
}) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const reduce = useReducedMotion();
  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  const x = scaleBand<number>()
    .domain(data.map((d) => d.key))
    .range([0, innerW])
    .paddingInner(0.28);
  const y = scaleLinear()
    .domain([0, (d3max(data, (d) => d.value ?? 0) ?? 1) * 1.1 || 1])
    .nice(4)
    .range([innerH, 0]);
  const bw = Math.min(24, x.bandwidth());
  const hovered = data.find((d) => d.key === hover);
  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={title}>
          <g transform={`translate(${M.left},${M.top})`}>
            {y.ticks(4).map((tk) => (
              <g key={tk} transform={`translate(0,${y(tk)})`}>
                <line x1={0} x2={innerW} className="chart__grid" />
                <text x={-8} dy="0.32em" className="chart__tick" textAnchor="end">
                  {formatValue(tk)}
                </text>
              </g>
            ))}
            <text x={-M.left + 2} y={-12} className="chart__unit">
              {unit}
            </text>
            {data.map((d, i) => {
              if (d.value === null) return null;
              const h = innerH - y(d.value);
              const bx = (x(d.key) ?? 0) + (x.bandwidth() - bw) / 2;
              const r = Math.min(4, h, bw / 2);
              const path = `M${bx},${innerH} V${innerH - h + r} Q${bx},${innerH - h} ${bx + r},${innerH - h} H${bx + bw - r} Q${bx + bw},${innerH - h} ${bx + bw},${innerH - h + r} V${innerH} Z`;
              const isHi = highlight?.has(d.key);
              return (
                <motion.path
                  key={d.key}
                  d={path}
                  fill={isHi ? color : 'var(--ink-4)'}
                  opacity={hover === null || hover === d.key ? 1 : 0.55}
                  initial={reduce ? false : { scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  style={{ originY: 1, transformBox: 'fill-box' }}
                  transition={{ duration: 0.45, ease: EASE_OUT, delay: reduce ? 0 : i * 0.012 }}
                />
              );
            })}
            <line x1={0} x2={innerW} y1={innerH} y2={innerH} className="chart__axis" />
            {data.map((d, i) =>
              i % Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(innerW / 44)))) === 0 ? (
                <text key={d.key} x={(x(d.key) ?? 0) + x.bandwidth() / 2} y={innerH + 18} className="chart__tick" textAnchor="middle">
                  {formatLabel(d.key)}
                </text>
              ) : null,
            )}
            {data.map((d) => (
              <rect
                key={`hit-${d.key}`}
                x={x(d.key)}
                y={0}
                width={x.bandwidth()}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${formatLabel(d.key)}: ${d.value === null ? 'no data' : formatValue(d.value)} ${unit}`}
                onPointerEnter={() => setHover(d.key)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(d.key)}
                onBlur={() => setHover(null)}
              />
            ))}
          </g>
        </svg>
      )}
      {hovered && hovered.value !== null && (
        <div className="chart__tooltip" style={{ left: Math.min(width - 160, M.left + (x(hovered.key) ?? 0) + x.bandwidth() + 6), top: M.top }}>
          <p className="chart__tooltip-time">{formatLabel(hovered.key)}</p>
          <p className="chart__tooltip-row">
            <strong className="num">{formatValue(hovered.value)}</strong>
            <span>{unit}</span>
          </p>
          {highlight?.has(hovered.key) && highlightLabel && <p className="chart__tooltip-note">{highlightLabel}</p>}
        </div>
      )}
      {highlight && highlightLabel && (
        <ul className="legend" aria-hidden="true">
          <li>
            <span className="legend__rect" style={{ background: color }} />
            {highlightLabel}
          </li>
          <li>
            <span className="legend__rect" style={{ background: 'var(--ink-4)' }} />
            Other hours
          </li>
        </ul>
      )}
    </div>
  );
}

// ---------- Heat grid: rows x 24 hours, sequential blue ----------

const SEQ = ['var(--seq-0)', 'var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)'];

export function HeatGrid({
  rows,
  cols,
  value,
  rowLabel,
  colLabel,
  formatValue,
  title,
}: {
  rows: string[];
  cols: number[];
  value: (row: string, col: number) => number | null;
  rowLabel: (row: string) => ReactNode;
  colLabel: (col: number) => string;
  formatValue: (v: number) => string;
  title: string;
}) {
  const [hover, setHover] = useState<{ row: string; col: number } | null>(null);
  const step = (v: number) => SEQ[Math.min(SEQ.length - 1, Math.floor(v * SEQ.length))];
  const hv = hover ? value(hover.row, hover.col) : null;
  return (
    <div className="heat" role="figure" aria-label={title}>
      <div className="heat__grid" style={{ gridTemplateColumns: `minmax(120px, 180px) repeat(${cols.length}, minmax(10px, 1fr))` }}>
        <span />
        {cols.map((c) => (
          <span key={c} className="heat__col">
            {c % 3 === 0 ? colLabel(c) : ''}
          </span>
        ))}
        {rows.map((r) => (
          <div key={r} className="heat__row">
            <span className="heat__label">{rowLabel(r)}</span>
            {cols.map((c) => {
              const v = value(r, c);
              return (
                <span
                  key={c}
                  className={`heat__cell ${hover?.row === r && hover.col === c ? 'is-hover' : ''}`}
                  style={{ background: v === null ? 'var(--surface-2)' : step(v) }}
                  tabIndex={0}
                  aria-label={`${r}, ${colLabel(c)}: ${v === null ? 'no data' : formatValue(v)}`}
                  onPointerEnter={() => setHover({ row: r, col: c })}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover({ row: r, col: c })}
                  onBlur={() => setHover(null)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="heat__foot">
        <p className="heat__readout" aria-live="polite">
          {hover ? (
            <>
              <strong className="num">{hv === null ? '–' : formatValue(hv)}</strong> {hover.row} at {colLabel(hover.col)}
            </>
          ) : (
            <span className="muted">Point at a cell to read it.</span>
          )}
        </p>
        <div className="heat__scale" aria-hidden="true">
          <span>0%</span>
          {SEQ.map((c) => (
            <i key={c} style={{ background: c }} />
          ))}
          <span>100%</span>
        </div>
      </div>
    </div>
  );
}

// ---------- Level bar: km of network at each level ----------

const LEVEL_ORDER: SegmentLevel[] = ['free', 'moderate', 'heavy', 'severe', 'no_data'];

export function LevelBar({ km, tall = false, title }: { km: Record<SegmentLevel, number>; tall?: boolean; title: string }) {
  const total = LEVEL_ORDER.reduce((a, l) => a + (km[l] ?? 0), 0);
  const parts = LEVEL_ORDER.filter((l) => (km[l] ?? 0) > 0);
  return (
    <div className="levelbar-wrap">
      <div className={`levelbar ${tall ? 'levelbar--tall' : ''}`} role="img" aria-label={`${title}: ${parts.map((l) => `${LEVEL_LABEL[l]} ${km[l].toFixed(1)} km`).join(', ')}`}>
        {parts.map((l) => {
          const share = total ? km[l] / total : 0;
          return (
            <span key={l} className={`levelbar__part levelbar__part--${l}`} style={{ flexGrow: share }} title={`${LEVEL_LABEL[l]}: ${km[l].toFixed(1)} km`}>
              {tall && share > 0.12 && <span className="levelbar__label num">{Math.round(share * 100)}%</span>}
            </span>
          );
        })}
      </div>
      <ul className="legend legend--levels">
        {parts.map((l) => (
          <li key={l}>
            <span className={`legend__rect swatch--${l}`} />
            {LEVEL_LABEL[l]} <span className="muted num">{km[l].toFixed(1)} km</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
