import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, ChevronDown, Unplug } from 'lucide-react';
import { LevelBar, Sparkline } from '../components/charts/charts';
import { TrafficMap } from '../components/map/TrafficMap';
import { SegmentDetail } from '../components/SegmentDetail';
import { AnimatedNumber, Empty, Health, LevelBadge, LevelSwatch, Notice, Segmented, SeverityBadge, useMediaQuery, useNow } from '../components/ui/primitives';
import { useAtRisk, useKmByLevel } from '../data/derived';
import { useLive } from '../data/store';
import {
  ALERT_KIND_LABEL,
  INCIDENT_TYPE_LABEL,
  LEVEL_LABEL,
  SEVERITY_RANK,
  fmtAgo,
  fmtInt,
  fmtOne,
  fmtShortTime,
  fmtSigned,
  fmtSpeed,
} from '../lib/format';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/** The network in one glance: speed, how much road is congested, who is reporting. */
function Brief({ mode, setMode, vehicles, setVehicles }: { mode: 'now' | 'forecast'; setMode: (m: 'now' | 'forecast') => void; vehicles: boolean; setVehicles: (v: boolean) => void }) {
  const summary = useLive((s) => s.summary);
  const history = useLive((s) => s.summaryHistory);
  const windowEnd = useLive((s) => s.windowEnd);
  const km = useKmByLevel();
  const speedPts = useMemo(() => history.map((h) => ({ t: h.t, v: h.avg_speed_kph })), [history]);
  const share = summary && summary.network_km ? summary.congested_km / summary.network_km : 0;

  return (
    <div className="cc__brief float enter" style={{ '--i': 80 } as React.CSSProperties}>
      <div className="cc__brief-top">
        <h1 className="cc__title">Command center</h1>
        <span className="cc__window num">{windowEnd ? `Window ${fmtShortTime(windowEnd)} IST` : 'Waiting for a window'}</span>
      </div>

      <div className="cc__speed kpis" aria-label="Network now">
        <div>
          <p className="cc__speed-value num">
            <AnimatedNumber value={summary?.avg_speed_kph ?? null} format={fmtSpeed} />
            <span className="cc__speed-unit">km/h</span>
          </p>
          <p className="cc__speed-label">Average network speed</p>
        </div>
        <Sparkline points={speedPts} color="var(--accent)" width={92} height={34} />
      </div>

      <div className="cc__congestion">
        <LevelBar km={km} title="Road length by congestion level" legend={false} />
        <p className="cc__congestion-text">
          <span className={`num ${share > 0.25 ? 'cc__hot' : ''}`}>
            <AnimatedNumber value={summary?.congested_km ?? null} format={fmtOne} /> km
          </span>{' '}
          of {summary ? fmtOne(summary.network_km) : '–'} km heavy or severe
        </p>
      </div>

      <dl className="cc__facts">
        <div>
          <dt>Vehicles reporting</dt>
          <dd className="num">
            <AnimatedNumber value={summary?.vehicles_active ?? null} format={fmtInt} />
          </dd>
        </div>
        <div>
          <dt>Active incidents</dt>
          <dd className={`num ${summary?.active_incidents ? 'cc__hot' : ''}`}>
            <AnimatedNumber value={summary?.active_incidents ?? null} format={fmtInt} />
          </dd>
        </div>
      </dl>

      <div className="cc__modes">
        <Segmented
          label="Map shows"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'now', label: 'Now' },
            { value: 'forecast', label: 'In 10 min' },
          ]}
        />
        <label className="toggle">
          <input type="checkbox" checked={vehicles} onChange={(e) => setVehicles(e.target.checked)} disabled={mode !== 'now'} />
          <span className="toggle__track" aria-hidden="true">
            <span className="toggle__thumb" />
          </span>
          Vehicles
        </label>
      </div>
    </div>
  );
}

/**
 * An inspector section the operator can fold away to give the others room.
 * The fold is the one height animation in the app (an accordion has no
 * transform equivalent), kept short; the choice survives reloads.
 */
function InsSection({ title, count, action, children }: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  const storeKey = `arterial.inspector.${title}`;
  const reduce = useReducedMotion();
  const bodyId = useId();
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(storeKey) !== 'closed';
    } catch {
      return true;
    }
  });
  const toggle = () =>
    setOpen((was) => {
      try {
        localStorage.setItem(storeKey, was ? 'closed' : 'open');
      } catch {
        // storage blocked: the fold still works for this visit
      }
      return !was;
    });
  return (
    <section className={`ins ${open ? '' : 'is-collapsed'}`} aria-label={title}>
      <header className="ins__head">
        <h2 className="ins__title">
          <button type="button" className="ins__toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
            <ChevronDown size={14} className="ins__chev" aria-hidden="true" />
            {title}
            {count !== undefined && <span className="ins__count num">{count}</span>}
          </button>
        </h2>
        {action}
      </header>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            id={bodyId}
            className="ins__body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduce ? { duration: 0 } : { height: { duration: 0.22, ease: EASE_OUT }, opacity: { duration: 0.16, ease: EASE_OUT } }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

type RowProps = { onSelect: (id: string) => void; onHover: (id: string | null) => void };

/** Pointer and keyboard focus on a row both light the road up on the map. */
const hoverProps = (id: string, onHover: (id: string | null) => void) => ({
  onPointerEnter: () => onHover(id),
  onPointerLeave: () => onHover(null),
  onFocus: () => onHover(id),
  onBlur: () => onHover(null),
});

function Alerts({ onSelect, onHover }: RowProps) {
  const alerts = useLive((s) => s.alerts);
  const segIndex = useLive((s) => s.segIndex);
  const now = useNow(5000);
  const shown = alerts.slice(0, 4);
  return (
    <InsSection title="Alerts" count={alerts.length}>
      {shown.length ? (
        <ul className="rows">
          <AnimatePresence initial={false}>
            {shown.map((a) => (
              <motion.li
                key={a.alert_id}
                layout="position"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: EASE_OUT }}
              >
                <button type="button" className="row cc-alert" onClick={() => onSelect(a.segment_id)} {...hoverProps(a.segment_id, onHover)}>
                  <span className="cc-alert__badge">
                    <LevelBadge level={a.level_to} size="sm" label={a.kind === 'cleared' ? 'Cleared' : undefined} />
                    <span className="muted">{ALERT_KIND_LABEL[a.kind]}</span>
                  </span>
                  <span className="row__meta num">{fmtAgo(a.raised_at, now)}</span>
                  <span className="row__title">{segIndex[a.segment_id]?.name ?? a.segment_id}</span>
                  <span className="cc-alert__text">{a.message}</span>
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <Empty title="No alerts">Alerts appear when a segment turns heavy or severe.</Empty>
      )}
    </InsSection>
  );
}

function AtRisk({ onSelect, onHover }: RowProps) {
  const predictions = useLive((s) => s.predictions);
  const states = useLive((s) => s.states);
  const segIndex = useLive((s) => s.segIndex);
  const rows = useAtRisk(10, 4);

  return (
    <InsSection
      title="Likely to slow in 10 min"
      action={
        <Link to="/forecast" className="link">
          Forecast <ArrowRight size={13} aria-hidden="true" />
        </Link>
      }
    >
      {!predictions ? (
        <Empty title="No forecast yet">Forecasts arrive with each closed window.</Empty>
      ) : rows.length ? (
        <ul className="rows">
          {rows.map((p) => {
            const now = states[p.segment_id]?.level ?? 'no_data';
            return (
              <li key={p.segment_id}>
                <button type="button" className="row cc-risk" onClick={() => onSelect(p.segment_id)} {...hoverProps(p.segment_id, onHover)}>
                  <span className="row__title">
                    {segIndex[p.segment_id]?.name ?? p.segment_id} <span className="mono muted">{p.segment_id}</span>
                  </span>
                  <span className="cc-risk__delta num">{fmtSigned(p.expected_change_kph)} km/h</span>
                  <span className="transition cc-risk__levels">
                    <LevelSwatch level={now} />
                    <span className="soft">{LEVEL_LABEL[now]}</span>
                    <span className="transition__arrow" aria-hidden="true">→</span>
                    <span className="visually-hidden">to</span>
                    <LevelSwatch level={p.predicted_level} />
                    <span>{LEVEL_LABEL[p.predicted_level]}</span>
                  </span>
                  <span className="meter cc-risk__meter" role="img" aria-label={`Risk score ${Math.round(p.risk * 100)} of 100`}>
                    <span className="meter__fill" style={{ transform: `scaleX(${p.risk})`, background: `var(--level-${p.predicted_level})` }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty title="Nothing slowing">No segment is forecast to get worse in the next 10 minutes.</Empty>
      )}
      {predictions && <p className="ins__note">{predictions.model.kind === 'rule_baseline' ? 'Rule-based baseline forecast.' : `Model ${predictions.model.version}.`} The bar is a risk score, not a probability.</p>}
    </InsSection>
  );
}

function ActiveIncidents() {
  const incidents = useLive((s) => s.incidents);
  const segIndex = useLive((s) => s.segIndex);
  const now = useNow(10_000);
  const active = Object.values(incidents)
    .filter((i) => i.status === 'active')
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.detected_at.localeCompare(a.detected_at));
  return (
    <InsSection
      title="Active incidents"
      count={active.length}
      action={
        <Link to="/incidents" className="link">
          All <ArrowRight size={13} aria-hidden="true" />
        </Link>
      }
    >
      {active.length ? (
        <ul className="rows">
          {active.slice(0, 3).map((i) => (
            <li key={i.incident_id}>
              <Link to={`/incidents/${i.incident_id}`} className="row cc-inc">
                <SeverityBadge severity={i.severity} size="sm" />
                <span className="row__title">
                  {INCIDENT_TYPE_LABEL[i.type]} <span className="muted">· {segIndex[i.segment_id]?.name ?? i.segment_id}</span>
                </span>
                <span className="row__meta num">{fmtAgo(i.detected_at, now)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No active incidents" />
      )}
      <p className="ins__note">Anomalies in simulated data, not verified accidents.</p>
    </InsSection>
  );
}

function PipelineLine() {
  const system = useLive((s) => s.system);
  return (
    <footer className="ins__foot">
      {system ? (
        <>
          <Health status={system.kafka.connected ? 'ok' : 'down'} label={system.kafka.connected ? 'Kafka' : 'Kafka down'} />
          <span className="num soft">{fmtInt(system.throughput.in_per_s)}/s in</span>
          <span className="num soft">p95 {fmtInt(system.latency_ms.p95)} ms</span>
        </>
      ) : (
        <span className="muted">No pipeline status</span>
      )}
      <Link to="/system" className="link ins__foot-link">
        System <ArrowRight size={13} aria-hidden="true" />
      </Link>
    </footer>
  );
}

export function CommandCenter() {
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const select = (id: string | null) => {
    setHovered(null);
    setSelected(id);
  };

  // Escape closes the segment and returns to the overview, unless a field or a dialog has the key.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, select, textarea, [role="dialog"]')) return;
      setSelected(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected]);
  const [mode, setMode] = useState<'now' | 'forecast'>('now');
  const [vehicles, setVehicles] = useState(true);
  const narrow = useMediaQuery('(max-width: 900px)');
  const medium = useMediaQuery('(max-width: 1180px)');
  const bootstrap = useLive((s) => s.bootstrap);
  const incidentsMap = useLive((s) => s.incidents);
  const active = useMemo(() => Object.values(incidentsMap).filter((i) => i.status === 'active'), [incidentsMap]);

  return (
    <div className="cc">
      <div className="cc__map">
        <TrafficMap
          ariaLabel="Live traffic map. Each road segment is coloured by its congestion level."
          mode={mode}
          horizon={10}
          selectedSegment={selected}
          hoverSegment={hovered}
          onSelectSegment={select}
          showVehicles={vehicles && mode === 'now'}
          incidents={active}
          showLegend
          padding={
            narrow
              ? { top: 24, right: 24, bottom: 64, left: 24 }
              : medium
                ? { top: 40, right: 380, bottom: 72, left: 210 }
                : { top: 40, right: 432, bottom: 72, left: 356 }
          }
        />
      </div>

      <Brief mode={mode} setMode={setMode} vehicles={vehicles} setVehicles={setVehicles} />

      {bootstrap.status === 'error' && (
        <div className="cc__error">
          <Notice tone="bad" title="Cannot load traffic data" icon={Unplug}>
            {bootstrap.error} The page retries on its own when the stream connects.
          </Notice>
        </div>
      )}

      <aside className="cc__inspector float enter" style={{ '--i': 140 } as React.CSSProperties} aria-label={selected ? 'Segment details' : 'Alerts and forecast'}>
        <AnimatePresence mode="wait" initial={false}>
          {selected ? (
            <motion.div
              key="detail"
              className="cc__pane cc__pane--detail"
              // drilling in: the segment arrives from the right and leaves the way it came
              initial={{ opacity: 0, transform: 'translateX(12px)' }}
              animate={{ opacity: 1, transform: 'translateX(0px)' }}
              exit={{ opacity: 0, transform: 'translateX(12px)', transition: { duration: 0.1, ease: EASE_OUT } }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
            >
              <SegmentDetail id={selected} onClose={() => select(null)} />
            </motion.div>
          ) : (
            <motion.div
              key="overview"
              className="cc__pane"
              // the overview sits to the left of the segment: it steps aside left, and comes back from the left
              initial={{ opacity: 0, transform: 'translateX(-12px)' }}
              animate={{ opacity: 1, transform: 'translateX(0px)' }}
              exit={{ opacity: 0, transform: 'translateX(-12px)', transition: { duration: 0.1, ease: EASE_OUT } }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
            >
              <div className="cc__scroll">
                <Alerts onSelect={select} onHover={setHovered} />
                <AtRisk onSelect={select} onHover={setHovered} />
                <ActiveIncidents />
              </div>
              <PipelineLine />
            </motion.div>
          )}
        </AnimatePresence>
      </aside>
    </div>
  );
}
