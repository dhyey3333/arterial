import { useInView, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';
import { Suspense, lazy, useCallback, useMemo, useRef, useState } from 'react';
import { HeatGrid } from '../components/charts/charts';
import { useAnalytics } from '../data/queries';
import { useLive } from '../data/store';
import { hasGpuWebGL } from '../lib/gpu';
import { fmtHour, fmtInt, fmtOne, fmtPct } from '../lib/format';

// three.js loads only when this section comes near
const HeatLandscape = lazy(() => import('../components/stack/HeatLandscape'));

const DAYS = 7;
const pct = (v: number) => fmtPct(v, { fromRatio: true });

/**
 * The analytics page's week landscape, played by the scroll: one bar per segment and hour, its height the
 * share of that hour spent heavy or severe. The bars rise in a wave across the hours when the section comes
 * into view, and the camera swings round the landscape and a little higher as the page moves past, so the
 * peaks read as ridges with depth. The values are the console's own analytics for the last seven days; with
 * none yet, the section says so. Without a hardware WebGL context it shows the same hours as the flat grid.
 */
export function WeekPeaks() {
  const q = useAnalytics(DAYS);
  const a = q.data;
  const segIndex = useLive((s) => s.segIndex);
  const reduce = !!useReducedMotion();
  const host = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const near = useInView(host, { once: true, margin: '600px 0px' });
  const seen = useInView(stage, { once: true, amount: 0.35 });

  // -1 as the section enters from below, +1 as it leaves at the top, with a little give so it settles
  const { scrollYProgress } = useScroll({ target: host, offset: ['start end', 'end start'] });
  const turn = useSpring(
    useTransform(scrollYProgress, [0, 1], [-1, 1]),
    { stiffness: 120, damping: 30, mass: 0.6 },
  );
  const still = useMotionValue(0);

  const ranked = useMemo(() => [...(a?.segments ?? [])].sort((x, y) => y.congested_minutes - x.congested_minutes), [a]);
  const rows = useMemo(() => ranked.slice(0, 12).map((s) => s.segment_id), [ranked]);
  const index = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of a?.heat ?? []) m.set(`${h.segment_id}|${h.hour}`, h.congested_share);
    return m;
  }, [a]);
  const value = useCallback((r: string, c: number) => index.get(`${r}|${c}`) ?? null, [index]);
  const name = useCallback((id: string) => segIndex[id]?.name ?? id, [segIndex]);
  const worst = a?.hourly.length ? a.hourly.reduce((m, h) => (h.congested_share > m.congested_share ? h : m), a.hourly[0]) : null;
  const top = ranked[0];
  // asked once on mount, so the words match the view that will show; the scene itself mounts only when near
  const [solid] = useState(() => hasGpuWebGL());
  const gpu = near && solid;

  return (
    <section className="lp-section lp-peaks" id="peaks" ref={host} aria-labelledby="lp-peaks-h">
      <div className="lp-wrap">
        <div className="lp-head lp-head--split">
          <div>
            <p className="lp-eyebrow">Analytics</p>
            <h2 id="lp-peaks-h" className="lp-h2">
              {solid ? 'When each corridor congests, as a landscape' : 'When each corridor congests'}
            </h2>
          </div>
          <p className="lp-lede">
            {solid
              ? `One bar for each segment and hour of the day, its height the share of that hour spent heavy or severe over the last ${DAYS} days. The most congested segment stands at the back.`
              : `One cell for each segment and hour of the day, its shade the share of that hour spent heavy or severe over the last ${DAYS} days. The most congested segment is at the top.`}
          </p>
        </div>

        <div className={`lp-peaks__stage ${gpu ? 'is-3d' : ''}`} ref={stage}>
          {a && rows.length ? (
            gpu ? (
              <Suspense fallback={null}>
                <HeatLandscape rows={rows} name={name} value={value} formatHour={fmtHour} formatValue={pct} play={seen} turn={reduce ? still : turn} />
              </Suspense>
            ) : near ? (
              <HeatGrid title="Congestion share by segment and hour" rows={rows} cols={Array.from({ length: 24 }, (_, h) => h)} value={value} rowLabel={name} colLabel={fmtHour} formatValue={pct} />
            ) : null
          ) : (
            <p className="lp-peaks__empty">{q.isError ? 'Analytics appear once the stream has stored its first windows' : a ? 'No congestion recorded yet' : 'Loading the stored windows'}</p>
          )}
        </div>

        {a && worst && top && (
          <dl className="lp-peaks__facts">
            <div>
              <dt>Worst hour</dt>
              <dd>
                <strong className="num">{fmtHour(worst.hour)}</strong>, with {pct(worst.congested_share)} of road heavy or severe
              </dd>
            </div>
            <div>
              <dt>Most congested segment</dt>
              <dd>
                <strong>{name(top.segment_id)}</strong>, {fmtOne(top.congested_minutes / 60)} hours congested
              </dd>
            </div>
            <div>
              <dt>History</dt>
              <dd>
                <strong className="num">{a.simulated_days === 1 ? 'One simulated day' : `${fmtInt(a.simulated_days)} simulated days`}</strong> of stored 30-second windows
              </dd>
            </div>
          </dl>
        )}
      </div>
    </section>
  );
}
