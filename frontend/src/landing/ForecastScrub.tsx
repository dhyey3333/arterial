import { animate, useInView, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { Prediction, SegmentLevel } from '../lib/contract';
import { LEVEL_LABEL, LEVEL_RANK } from '../lib/format';
import { ForecastMap, type Flagged } from './ForecastMap';
import type { Plane } from './geometry';

const STOPS = [0, 5, 10, 15] as const;
const LEVELS = ['free', 'moderate', 'heavy', 'severe'] as const satisfies readonly SegmentLevel[];

// the map follows the scroll through a spring: momentum on a wheel's jumps, a little over critical damping
// so it never overshoots, and settled in about half a second
const FOLLOW = { stiffness: 120, damping: 22, mass: 0.6 };
// the opening is a one-off, explanatory moment: a gentler ease-out than the interface's, so it reads as
// opening rather than snapping
const EASE_OPEN = [0.22, 0.61, 0.36, 1] as const;
// as the clock runs, the camera creeps in over the city
const PUSH = 0.05;
// the opening: the frame opens from a soft inset while the city settles from a little closer
const OPEN_SCALE = 0.08;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The forecast, played by the scroll: the section holds the screen while the page moves through it, and
 * the clock runs from now to 15 minutes ahead. Beside the steps, the city at night with every monitored
 * corridor on its road, coloured by the console's own forecast of its speed at that minute: green at free
 * flow, through amber, to red at severe. Headlights run along each corridor at its forecast speed.
 *
 * The motion: the clock and the steps follow the scroll exactly; the map follows it through a spring. The
 * camera creeps a little closer as the minutes pass, and the frame opens once, the first time it comes
 * into view, with the corridors drawing themselves in. Under reduced motion the colours still follow the
 * scroll, nothing else moves.
 */
export function ForecastScrub({
  plane,
  now,
  predictions,
}: {
  plane: Plane;
  now: Record<string, SegmentLevel> | null;
  predictions: Prediction[] | null;
}) {
  const reduce = !!useReducedMotion();
  const host = useRef<HTMLElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const { scrollYProgress } = useScroll({ target: host, offset: ['start start', 'end end'] });
  // hold "now" for the first stretch and "15 min" for the last, so both ends can be read
  const minutes = useTransform(scrollYProgress, [0.08, 0.88], [0, 15], { clamp: true });
  const followed = useSpring(minutes, FOLLOW);
  const fill = useTransform(minutes, [0, 15], [0, 1]);
  const [step, setStep] = useState<(typeof STOPS)[number]>(0);

  // the opening, once: 0 closed, 1 open
  const opened = useMotionValue(reduce ? 1 : 0);
  const seen = useInView(frame, { once: true, amount: 0.35 });
  const clip = useTransform(opened, (o) => {
    const y = ((1 - o) * 7).toFixed(2);
    const x = ((1 - o) * 5).toFixed(2);
    return `inset(${y}% ${x}% ${y}% ${x}% round var(--r-xl))`;
  });
  useEffect(() => {
    if (!seen) return;
    if (reduce) {
      opened.set(1);
      return;
    }
    const run = animate(opened, 1, { duration: 1.1, ease: EASE_OPEN });
    return () => run.stop();
  }, [seen, reduce, opened]);

  const levelsAt = useMemo(() => {
    if (!now || !predictions?.length) return null;
    const at: Record<number, Record<string, SegmentLevel>> = { 0: now };
    for (const p of predictions) (at[p.horizon_min] ??= {})[p.segment_id] = p.predicted_level;
    return at;
  }, [now, predictions]);

  // the corridor the forecast flags worst (the highest level 15 minutes ahead, then the biggest fall, then
  // the lowest forecast speed). Chosen once per visit, so the label keeps to one road while newer
  // forecasts move its speed
  const kept = useRef<string | null>(null);
  const worst = useMemo(() => {
    if (!levelsAt) return null;
    const known = (id: string) => !!levelsAt[0][id] && levelsAt[0][id] !== 'no_data';
    let seg = plane.segments.find((s) => s.id === kept.current && known(s.id));
    if (!seg) {
      let best = -Infinity;
      for (const s of plane.segments) {
        const l0 = levelsAt[0][s.id];
        const l15 = levelsAt[15]?.[s.id] ?? l0;
        if (!known(s.id) || !l15 || l15 === 'no_data') continue;
        const kph = predictions?.find((q) => q.segment_id === s.id && q.horizon_min === 15)?.predicted_speed_kph;
        const share = kph != null && s.freeFlowKph ? Math.min(1, kph / s.freeFlowKph) : 1;
        const score = LEVEL_RANK[l15] * 10 + (LEVEL_RANK[l15] - LEVEL_RANK[l0]) * 3 + (1 - share);
        if (score > best) {
          best = score;
          seg = s;
        }
      }
    }
    if (!seg) return null;
    kept.current = seg.id;
    return seg;
  }, [levelsAt, plane, predictions]);

  // its name and its speed at the step the clock is on: the current speed now, the forecast at 5, 10, 15
  const flagged = useMemo<Flagged | null>(() => {
    if (!worst) return null;
    const rows = predictions?.filter((p) => p.segment_id === worst.id) ?? [];
    const kph = step === 0 ? (rows[0]?.current_speed_kph ?? null) : (rows.find((p) => p.horizon_min === step)?.predicted_speed_kph ?? null);
    return { id: worst.id, name: worst.name, kph };
  }, [worst, predictions, step]);

  const worse = useMemo(() => {
    if (!levelsAt) return null;
    const out: Record<number, number> = {};
    for (const h of STOPS) {
      out[h] = plane.segments.filter((s) => LEVEL_RANK[levelsAt[h]?.[s.id] ?? 'no_data'] > LEVEL_RANK[levelsAt[0][s.id] ?? 'no_data']).length;
    }
    return out;
  }, [levelsAt, plane]);

  // what the map shows at this step, in words, for anyone who cannot see it
  const said = useMemo(() => {
    if (!levelsAt) return `A map of Bengaluru at night with Arterial's ${plane.segments.length} corridors. No forecast yet.`;
    const at = levelsAt[step] ?? levelsAt[0];
    const counts = LEVELS.map((l) => [l, plane.segments.filter((s) => at[s.id] === l).length] as const).filter(([, n]) => n > 0);
    return `A map of Bengaluru at night with Arterial's ${plane.segments.length} corridors coloured by the forecast ${step === 0 ? 'now' : `in ${step} minutes`}: ${counts.map(([l, n]) => `${n} ${LEVEL_LABEL[l].toLowerCase()}`).join(', ')}.`;
  }, [levelsAt, plane, step]);

  // the words follow the scroll exactly
  const paint = (m: number) => {
    if (clock.current) clock.current.textContent = m < 0.5 ? 'Now' : `+${Math.round(m)} min`;
    const s = m >= 15 ? 15 : m >= 10 ? 10 : m >= 5 ? 5 : 0;
    setStep((prev) => (prev === s ? prev : (s as (typeof STOPS)[number])));
  };

  // how close the camera is: a little closer as the minutes pass, and closer still before the opening
  const frameCamera = () => {
    if (!media.current) return;
    const push = reduce ? 1 : 1 + PUSH * clamp01(followed.get() / 15);
    const open = 1 + OPEN_SCALE * (1 - opened.get());
    media.current.style.transform = `scale(${(push * open).toFixed(4)})`;
  };

  useMotionValueEvent(minutes, 'change', paint);
  useMotionValueEvent(followed, 'change', frameCamera);
  useMotionValueEvent(opened, 'change', frameCamera);
  useEffect(() => {
    paint(minutes.get());
    frameCamera();
  }, []);

  return (
    <section className="lp-scrub" id="forecast" ref={host} aria-labelledby="lp-scrub-h">
      <div className="lp-scrub__stick">
        <div className="lp-wrap lp-scrub__grid">
          <div className="lp-scrub__text">
            <p className="lp-eyebrow">Forecast</p>
            <h2 id="lp-scrub-h" className="lp-h2">
              Watch the jam form before it forms
            </h2>
            <p className="lp-lede">
              Arterial forecasts every segment 5, 10 and 15 minutes ahead, with a range. Scroll, and each corridor takes the colour the console's own
              forecast gives it.
            </p>
            <ol className="lp-steps">
              {STOPS.map((h) => (
                <li key={h} className={step === h ? 'is-on' : step > h ? 'is-past' : ''}>
                  <span className="lp-steps__t num">{h === 0 ? 'Now' : `${h} min`}</span>
                  <span className="lp-steps__d">
                    {worse ? (h === 0 ? 'Levels from the latest 30-second window' : `${worse[h]} of ${plane.segments.length} segments forecast to get worse`) : h === 0 ? 'Waiting for the first window' : 'Forecasts appear once the stream runs'}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="lp-scrub__map">
            <div className="lp-clock" aria-hidden="true">
              <span ref={clock} className="num">
                Now
              </span>
            </div>
            <motion.div ref={frame} className="lp-scrub__net lp-fmap" style={{ clipPath: clip }} role="img" aria-label={said}>
              <ForecastMap
                plane={plane}
                now={now}
                predictions={predictions}
                minute={reduce ? minutes : followed}
                flagged={flagged}
                drawn={seen || reduce}
                moving={!paused && !reduce}
                mediaRef={media}
              />
              <div className="lp-fmap__key" aria-hidden="true">
                <span>Free flow</span>
                <i />
                <span>Severe</span>
              </div>
              {!reduce && levelsAt && (
                <button type="button" className="lp-pause lp-pause--map" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play the traffic' : 'Pause the traffic'} aria-pressed={paused}>
                  {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
                </button>
              )}
            </motion.div>
            <div className="lp-rail" aria-hidden="true">
              <div className="lp-rail__track">
                <motion.div className="lp-rail__fill" style={{ scaleX: fill }} />
              </div>
              <div className="lp-rail__ticks">
                {STOPS.map((h) => (
                  <span key={h} className="num">
                    {h === 0 ? 'Now' : `+${h}`}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
