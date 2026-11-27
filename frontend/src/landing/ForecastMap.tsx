import { useMotionValueEvent, type MotionValue } from 'motion/react';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import type { Prediction, SegmentLevel } from '../lib/contract';
import { LEVEL_RGB, type Plane } from './geometry';
import shape from './forecastCorridors.json';

// The city at night under the forecast camera: OpenFreeMap's vector tiles (OpenStreetMap data, ODbL) drawn
// with the landing's night-city layers and saved as one picture, so it shows at once on any connection.
// The corridors are drawn over it from the same camera (forecastCorridors.json, projected when the picture
// was made), so they sit exactly on their roads.
const STILL = '/landing/forecast-city.webp';
const W = shape.w;
const H = shape.h;

type RGB = readonly [number, number, number];
// Each level's colour sits at the middle of its band of the share of free-flow speed (free 0.75 and up,
// moderate from 0.5, heavy from 0.3, severe below), so a road wears its level's own colour at a forecast
// step and blends between levels as the minutes run between steps.
const RAMP: [number, RGB][] = [
  [0.875, LEVEL_RGB.free],
  [0.625, LEVEL_RGB.moderate],
  [0.4, LEVEL_RGB.heavy],
  [0.15, LEVEL_RGB.severe],
];
const BAND_MIDDLE: Partial<Record<SegmentLevel, number>> = { free: 0.875, moderate: 0.625, heavy: 0.4, severe: 0.15 };
const WAITING = '#56565c';
// how fast the headlights run at free flow, in picture units a second: at severe they crawl
const CRUISE = 64;

function colourAt(r: number): RGB {
  if (r >= RAMP[0][0]) return RAMP[0][1];
  for (let i = 1; i < RAMP.length; i++) {
    const [r1, c1] = RAMP[i];
    if (r < r1) continue;
    const [r0, c0] = RAMP[i - 1];
    const k = (r0 - r) / (r0 - r1);
    return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
  }
  return RAMP[RAMP.length - 1][1];
}

const rgb = (c: RGB, white = 0) =>
  `rgb(${Math.round(c[0] + (255 - c[0]) * white)} ${Math.round(c[1] + (255 - c[1]) * white)} ${Math.round(c[2] + (255 - c[2]) * white)})`;

/** A share of free-flow speed at a minute between the forecast's steps (0, 5, 10, 15). */
function shareAt(s: number[], m: number) {
  const f = Math.min(3, Math.max(0, m / 5));
  const i = Math.min(2, Math.floor(f));
  return s[i] + (s[i + 1] - s[i]) * (f - i);
}

// every corridor as points 4 units apart, for the headlights and the corridor labels
const ROADS = shape.corridors.map((c) => {
  const raw = c.d
    .slice(1)
    .split('L')
    .map((p) => p.split(' ').map(Number) as [number, number]);
  const pts: [number, number][] = [raw[0]];
  let carry = 0;
  for (let i = 1; i < raw.length; i++) {
    const [x0, y0] = raw[i - 1];
    const [x1, y1] = raw[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    let at = 4 - carry;
    while (at <= seg) {
      pts.push([x0 + ((x1 - x0) * at) / seg, y0 + ((y1 - y0) * at) / seg]);
      at += 4;
    }
    carry = seg - (at - 4);
  }
  pts.push(raw[raw.length - 1]);
  const len = (pts.length - 1) * 4;
  return { id: c.id, d: c.d, pts, len, cars: Math.max(2, Math.min(9, Math.round(len / 95))) };
});

const along = (pts: [number, number][], t: number) => {
  const f = t * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  const k = f - i;
  return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
};

// The worst corridor's tag goes beside its road where it covers the fewest other corridors, clear of the
// frame's corners (the clock top right, the key bottom left, the pause button bottom right). Sizes are in
// picture units at the desktop frame's scale.
const PX = 1600 / 680;
const KEEP_CLEAR = [
  [W - 520, 0, W, 220],
  [0, H - 150, 640, H],
  [W - 150, H - 150, W, H],
];
type Side = 'above' | 'below' | 'right' | 'left';
// the tag is held by the edge that faces its road, so its real width never covers the ring
const HOLD: Record<Side, string> = {
  above: 'translate(-50%, calc(-100% - var(--gap)))',
  below: 'translate(-50%, var(--gap))',
  right: 'translate(var(--gap), -50%)',
  left: 'translate(calc(-100% - var(--gap)), -50%)',
};

function placeTag(id: string, name: string) {
  const road = ROADS.find((r) => r.id === id);
  if (!road) return null;
  const w = (name.length * 7.6 + 100) * PX;
  const h = 30 * PX;
  const gap = 14 * PX;
  let best: { score: number; ax: number; ay: number; x: number; y: number; side: Side } | null = null;
  for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
    const [ax, ay] = along(road.pts, t);
    for (const [x, y, side] of [
      [ax - w / 2, ay - gap - h, 'above'],
      [ax - w / 2, ay + gap, 'below'],
      [ax + gap, ay - h / 2, 'right'],
      [ax - gap - w, ay - h / 2, 'left'],
    ] as const) {
      const inside = (px: number, py: number) => px > x - 8 && px < x + w + 8 && py > y - 8 && py < y + h + 8;
      let score = Math.abs(t - 0.5) * 4;
      if (x < 16 || y < 16 || x + w > W - 16 || y + h > H - 16) score += 1000;
      for (const [x0, y0, x1, y1] of KEEP_CLEAR) if (x < x1 && x + w > x0 && y < y1 && y + h > y0) score += 500;
      for (const other of ROADS) for (const [px, py] of other.pts) if (inside(px, py)) score += other.id === id ? 2 : 1;
      if (!best || score < best.score) best = { score, ax, ay, x, y, side };
    }
  }
  return best;
}

export interface Flagged {
  id: string;
  name: string;
  kph: number | null;
}

/**
 * The forecast on the city: each monitored corridor drawn on its road and coloured by the console's forecast
 * of its speed, as a share of its free-flow speed, at the minute the scroll has reached, from green at free
 * flow to red at severe. Between the forecast's steps the colour blends from one step's forecast to the
 * next; the steps themselves are the model's output. Headlights run along each corridor at its forecast
 * speed, so they slow as it reddens. The corridor the forecast flags worst carries its name and its
 * forecast speed at the current step.
 *
 * With no forecast yet the corridors are grey and nothing moves. The headlights pause with the button and
 * while off screen, and under reduced motion they are not drawn.
 */
export function ForecastMap({
  plane,
  now,
  predictions,
  minute,
  flagged,
  drawn,
  moving,
  mediaRef,
}: {
  plane: Plane;
  now: Record<string, SegmentLevel> | null;
  predictions: Prediction[] | null;
  /** The clock, 0 to 15 minutes, smoothed. */
  minute: MotionValue<number>;
  flagged: Flagged | null;
  /** The corridors draw themselves in once, when the frame first opens. */
  drawn: boolean;
  /** Whether the headlights run: not paused, not under reduced motion. */
  moving: boolean;
  mediaRef: RefObject<HTMLDivElement | null>;
}) {
  const host = useRef<SVGSVGElement>(null);
  const glows = useRef<(SVGPathElement | null)[]>([]);
  const cores = useRef<(SVGPathElement | null)[]>([]);
  const cars = useRef<(SVGCircleElement | null)[][]>([]);
  const tagDot = useRef<HTMLElement>(null);

  // each corridor's share of free-flow speed now and at 5, 10 and 15 minutes, from the forecast
  const shares = useMemo(() => {
    if (!now || !predictions?.length) return null;
    const free = new Map(plane.segments.map((s) => [s.id, s.freeFlowKph]));
    const out: Record<string, number[]> = {};
    for (const p of predictions) {
      const ff = free.get(p.segment_id);
      if (!ff) continue;
      const row = (out[p.segment_id] ??= [NaN, NaN, NaN, NaN]);
      const i = [5, 10, 15].indexOf(p.horizon_min) + 1;
      if (i > 0) row[i] = Math.min(1, Math.max(0, p.predicted_speed_kph / ff));
      if (p.current_speed_kph != null) row[0] = Math.min(1, Math.max(0, p.current_speed_kph / ff));
    }
    for (const [id, row] of Object.entries(out)) {
      // no current speed: the level the latest window gives, at the middle of its band
      if (Number.isNaN(row[0])) row[0] = BAND_MIDDLE[now[id]] ?? NaN;
      for (let i = 1; i < 4; i++) if (Number.isNaN(row[i])) row[i] = row[i - 1];
      if (row.some(Number.isNaN)) delete out[id];
    }
    return Object.keys(out).length ? out : null;
  }, [now, predictions, plane]);

  // the share each corridor is at, read by the headlights each frame
  const current = useRef<number[]>(ROADS.map(() => 1));

  const paint = (m: number) => {
    ROADS.forEach((road, i) => {
      const s = shares?.[road.id];
      const r = s ? shareAt(s, m) : 1;
      current.current[i] = r;
      const colour = s ? rgb(colourAt(r)) : WAITING;
      glows.current[i]?.setAttribute('stroke', colour);
      cores.current[i]?.setAttribute('stroke', s ? rgb(colourAt(r), 0.12) : WAITING);
      const light = s ? rgb(colourAt(r), 0.7) : WAITING;
      for (const c of cars.current[i] ?? []) c?.setAttribute('fill', light);
      if (road.id === flagged?.id && tagDot.current) tagDot.current.style.background = colour;
    });
  };
  useMotionValueEvent(minute, 'change', paint);
  useEffect(() => paint(minute.get()), [shares, moving, flagged?.id]);

  // the headlights: each runs along its corridor at the corridor's forecast speed, from where the last
  // one started, and only while the frame is on screen
  useEffect(() => {
    const svg = host.current;
    if (!svg || !shares || !moving) return;
    const t = ROADS.map((road) => Array.from({ length: road.cars }, (_, k) => (k + 0.37 * (road.len % 7) / 7) / road.cars));
    let raf = 0;
    let last = 0;
    let visible = false;
    const frame = (time: number) => {
      const dt = last ? Math.min(0.05, (time - last) / 1000) : 0;
      last = time;
      ROADS.forEach((road, i) => {
        const step = (CRUISE * current.current[i] * dt) / road.len;
        t[i].forEach((v, k) => {
          const u = (v + step) % 1;
          t[i][k] = u;
          const c = cars.current[i]?.[k];
          if (!c) return;
          const [x, y] = along(road.pts, u);
          c.setAttribute('cx', x.toFixed(1));
          c.setAttribute('cy', y.toFixed(1));
          // in and out softly at the corridor's ends, so a light never pops
          c.setAttribute('opacity', Math.min(1, u * 12, (1 - u) * 12).toFixed(2));
        });
      });
      raf = requestAnimationFrame(frame);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      cancelAnimationFrame(raf);
      last = 0;
      if (visible) raf = requestAnimationFrame(frame);
    });
    io.observe(svg);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [shares, moving]);

  const tag = useMemo(() => (flagged ? placeTag(flagged.id, flagged.name) : null), [flagged?.id, flagged?.name]);

  return (
    <div ref={mediaRef} className="lp-fmap__media">
      <img className="lp-fmap__still" src={STILL} alt="" decoding="async" loading="lazy" width={W} height={H} />
      <svg ref={host} className={`lp-fmap__svg ${drawn ? 'is-drawn' : ''} ${shares ? '' : 'is-waiting'}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g className="lp-fmap__glow">
          {ROADS.map((road, i) => (
            <path
              key={road.id}
              ref={(el) => {
                glows.current[i] = el;
              }}
              d={road.d}
              stroke={WAITING}
              style={{ ['--d' as string]: `${i * 40}ms` }}
            />
          ))}
        </g>
        <g className="lp-fmap__core">
          {ROADS.map((road, i) => (
            <path
              key={road.id}
              ref={(el) => {
                cores.current[i] = el;
              }}
              d={road.d}
              pathLength={1}
              stroke={WAITING}
              className={flagged?.id === road.id ? 'is-flagged' : undefined}
              style={{ ['--d' as string]: `${i * 40}ms` }}
            />
          ))}
        </g>
        {tag && <circle className="lp-fmap__pin" cx={tag.ax} cy={tag.ay} r={13} />}
        {shares && moving && (
          <g className="lp-fmap__cars">
            {ROADS.map((road, i) =>
              Array.from({ length: road.cars }, (_, k) => (
                <circle
                  key={`${road.id}-${k}`}
                  ref={(el) => {
                    (cars.current[i] ??= [])[k] = el;
                  }}
                  r={5}
                  cx={road.pts[0][0]}
                  cy={road.pts[0][1]}
                  opacity={0}
                />
              )),
            )}
          </g>
        )}
      </svg>
      {flagged && tag && (
        <p className="lp-fmap__tag" style={{ left: `${((tag.ax / W) * 100).toFixed(2)}%`, top: `${((tag.ay / H) * 100).toFixed(2)}%`, transform: HOLD[tag.side] }}>
          <i ref={tagDot} />
          <span>{flagged.name}</span>
          {flagged.kph != null && <span className="num">{Math.round(flagged.kph)} km/h</span>}
        </p>
      )}
    </div>
  );
}
