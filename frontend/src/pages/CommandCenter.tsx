import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Unplug } from 'lucide-react';
import { TrafficMap } from '../components/map/TrafficMap';
import { SegmentDetail } from '../components/SegmentDetail';
import { Empty, Health, LevelBadge, Notice, Panel, Segmented, SeverityBadge, Stat, useNow } from '../components/ui/primitives';
import { useLive } from '../data/store';
import {
  ALERT_KIND_LABEL,
  INCIDENT_TYPE_LABEL,
  LEVEL_RANK,
  SEVERITY_RANK,
  fmtAgo,
  fmtInt,
  fmtOne,
  fmtSigned,
  fmtSpeed,
} from '../lib/format';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

function Kpis() {
  const summary = useLive((s) => s.summary);
  return (
    <div className="kpis" aria-label="Network now">
      <Stat label="Average speed" value={summary?.avg_speed_kph ?? null} format={fmtSpeed} unit="km/h" />
      <Stat label="Vehicles reporting" value={summary?.vehicles_active ?? null} format={fmtInt} />
      <Stat
        label="Congested road"
        value={summary?.congested_km ?? null}
        format={fmtOne}
        unit="km"
        note={summary ? `of ${fmtOne(summary.network_km)} km, heavy or severe` : undefined}
        tone={summary && summary.congested_km / summary.network_km > 0.25 ? 'bad' : undefined}
      />
      <Stat label="Active incidents" value={summary?.active_incidents ?? null} format={fmtInt} tone={summary?.active_incidents ? 'warn' : undefined} />
    </div>
  );
}

function Alerts({ onSelect }: { onSelect: (id: string) => void }) {
  const alerts = useLive((s) => s.alerts);
  const segIndex = useLive((s) => s.segIndex);
  const now = useNow(5000);
  const shown = alerts.slice(0, 5);
  return (
    <Panel title="Alerts" meta="Level changes routed by the Condense Split and Alerts utilities" enter={60}>
      {shown.length ? (
        <ul className="feed">
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
                <button type="button" className="feed__item" onClick={() => onSelect(a.segment_id)}>
                  <LevelBadge level={a.level_to} size="sm" label={a.kind === 'cleared' ? 'Cleared' : undefined} />
                  <span className="feed__main">
                    <span className="feed__title">{segIndex[a.segment_id]?.name ?? a.segment_id}</span>
                    <span className="feed__text">{a.message}</span>
                  </span>
                  <span className="feed__meta">
                    <span>{ALERT_KIND_LABEL[a.kind]}</span>
                    <span className="num">{fmtAgo(a.raised_at, now)}</span>
                  </span>
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <Empty title="No alerts">Alerts appear when a segment turns heavy or severe.</Empty>
      )}
    </Panel>
  );
}

function AtRisk({ onSelect }: { onSelect: (id: string) => void }) {
  const predictions = useLive((s) => s.predictions);
  const states = useLive((s) => s.states);
  const segIndex = useLive((s) => s.segIndex);
  const rows = useMemo(() => {
    if (!predictions) return [];
    return predictions.predictions
      .filter((p) => p.horizon_min === 10)
      .filter((p) => LEVEL_RANK[p.predicted_level] > LEVEL_RANK[states[p.segment_id]?.level ?? 'no_data'] || (p.risk >= 0.5 && p.expected_change_kph <= -2))
      .sort((a, b) => b.risk - a.risk || a.expected_change_kph - b.expected_change_kph)
      .slice(0, 5);
  }, [predictions, states]);

  return (
    <Panel
      title="Likely to slow in 10 min"
      meta={predictions ? (predictions.model.kind === 'rule_baseline' ? 'Rule-based baseline forecast' : `Model ${predictions.model.version}`) : undefined}
      actions={
        <Link to="/forecast" className="link-arrow">
          Forecast <ArrowRight size={14} aria-hidden="true" />
        </Link>
      }
      enter={100}
    >
      {!predictions ? (
        <Empty title="No forecast yet">Forecasts arrive with each closed window.</Empty>
      ) : rows.length ? (
        <ul className="risklist">
          {rows.map((p) => {
            const now = states[p.segment_id]?.level ?? 'no_data';
            return (
              <li key={p.segment_id}>
                <button type="button" className="risklist__item" onClick={() => onSelect(p.segment_id)}>
                  <span className="risklist__name">
                    {segIndex[p.segment_id]?.name ?? p.segment_id}
                    <span className="mono muted">{p.segment_id}</span>
                  </span>
                  <span className="risklist__levels">
                    <LevelBadge level={now} size="sm" />
                    <span aria-hidden="true" className="muted">→</span>
                    <span className="visually-hidden">to</span>
                    <LevelBadge level={p.predicted_level} size="sm" />
                  </span>
                  <span className="risklist__nums num">
                    {fmtSigned(p.expected_change_kph)} km/h
                    <span className="riskbar" aria-label={`Risk score ${Math.round(p.risk * 100)} of 100`}>
                      <span className="riskbar__fill" style={{ transform: `scaleX(${p.risk})` }} />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty title="Nothing slowing">No segment is forecast to get worse in the next 10 minutes.</Empty>
      )}
    </Panel>
  );
}

function ActiveIncidents() {
  const incidents = useLive((s) => s.incidents);
  const segIndex = useLive((s) => s.segIndex);
  const active = Object.values(incidents)
    .filter((i) => i.status === 'active')
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.detected_at.localeCompare(a.detected_at));
  return (
    <Panel
      title="Active incidents"
      meta="Anomalies in simulated data, not verified accidents"
      actions={
        <Link to="/incidents" className="link-arrow">
          All <ArrowRight size={14} aria-hidden="true" />
        </Link>
      }
      enter={140}
    >
      {active.length ? (
        <ul className="minilist">
          {active.slice(0, 3).map((i) => (
            <li key={i.incident_id}>
              <Link to={`/incidents/${i.incident_id}`} className="minilist__link">
                <SeverityBadge severity={i.severity} size="sm" />
                <span className="minilist__main">
                  {INCIDENT_TYPE_LABEL[i.type]}
                  <span className="muted"> · {segIndex[i.segment_id]?.name ?? i.segment_id}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No active incidents" />
      )}
    </Panel>
  );
}

function PipelineGlance() {
  const system = useLive((s) => s.system);
  const conn = useLive((s) => s.connection);
  return (
    <Panel
      title="Pipeline"
      actions={
        <Link to="/system" className="link-arrow">
          System <ArrowRight size={14} aria-hidden="true" />
        </Link>
      }
      enter={170}
    >
      <dl className="glance">
        <div>
          <dt>Kafka</dt>
          <dd>{system ? <Health status={system.kafka.connected ? 'ok' : 'down'} label={system.kafka.connected ? 'Connected' : 'Down'} /> : '–'}</dd>
        </div>
        <div>
          <dt>Events in</dt>
          <dd className="num">{system ? `${fmtInt(system.throughput.in_per_s)}/s` : '–'}</dd>
        </div>
        <div>
          <dt>Latency p95</dt>
          <dd className="num">{system ? `${fmtInt(system.latency_ms.p95)} ms` : '–'}</dd>
        </div>
        <div>
          <dt>Stream</dt>
          <dd>
            <Health
              status={conn.state === 'live' ? 'ok' : conn.state === 'reconnecting' || conn.state === 'connecting' ? 'degraded' : 'down'}
              label={conn.state === 'live' ? 'Live' : conn.state === 'idle' ? 'Idle' : conn.state[0].toUpperCase() + conn.state.slice(1)}
            />
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

export function CommandCenter() {
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'now' | 'forecast'>('now');
  const [vehicles, setVehicles] = useState(true);
  const bootstrap = useLive((s) => s.bootstrap);
  const incidentsMap = useLive((s) => s.incidents);
  const active = useMemo(() => Object.values(incidentsMap).filter((i) => i.status === 'active'), [incidentsMap]);

  return (
    <div className="cc">
      <div className="cc__map enter" style={{ '--i': 0 } as React.CSSProperties}>
        <TrafficMap
          ariaLabel="Live traffic map. Each road segment is coloured by its congestion level."
          mode={mode}
          horizon={10}
          selectedSegment={selected}
          onSelectSegment={setSelected}
          showVehicles={vehicles && mode === 'now'}
          incidents={active}
          showLegend
          padding={{ top: 150, right: 48, bottom: 72, left: 48 }}
        />
        <div className="cc__overlay">
          <Kpis />
          <div className="cc__mapbar">
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
        {bootstrap.status === 'error' && (
          <div className="cc__error">
            <Notice tone="bad" title="Cannot load traffic data" icon={Unplug}>
              {bootstrap.error} The page retries on its own when the stream connects.
            </Notice>
          </div>
        )}
      </div>
      <aside className="cc__dock" aria-label={selected ? 'Segment details' : 'Alerts and forecast'}>
        <AnimatePresence mode="wait" initial={false}>
          {selected ? (
            <motion.div
              key="detail"
              className="cc__dock-inner"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8, transition: { duration: 0.14 } }}
              transition={{ duration: 0.22, ease: EASE_OUT }}
            >
              <Panel>
                <SegmentDetail id={selected} onClose={() => setSelected(null)} />
              </Panel>
            </motion.div>
          ) : (
            <motion.div
              key="overview"
              className="cc__dock-inner"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.18 }}
            >
              <Alerts onSelect={setSelected} />
              <AtRisk onSelect={setSelected} />
              <ActiveIncidents />
              <PipelineGlance />
            </motion.div>
          )}
        </AnimatePresence>
      </aside>
    </div>
  );
}
