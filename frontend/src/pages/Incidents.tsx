import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { FlaskConical } from 'lucide-react';
import { TrafficMap } from '../components/map/TrafficMap';
import { Empty, LevelBadge, Notice, Panel, Segmented, SeverityBadge, useNow } from '../components/ui/primitives';
import { useIncident } from '../data/queries';
import { useLive } from '../data/store';
import type { Incident } from '../lib/contract';
import { INCIDENT_TYPE_LABEL, SEVERITY_RANK, fmtAgo, fmtDateTime, fmtInt, fmtNum, fmtOne, fmtSigned, fmtSpeed, fmtTime } from '../lib/format';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
type StatusFilter = 'active' | 'resolved' | 'all';

function change(baseline: number, observed: number): string {
  if (baseline === 0) return fmtSigned(observed, 1);
  const pct = ((observed - baseline) / Math.abs(baseline)) * 100;
  return `${fmtSigned(pct)}%`;
}

function IncidentDetail({ incident }: { incident: Incident }) {
  const segIndex = useLive((s) => s.segIndex);
  const seg = segIndex[incident.segment_id];
  const focus = useMemo(() => [incident.segment_id, ...incident.affected_segments], [incident]);
  return (
    <div className="incdetail">
      <header className="incdetail__head">
        <div>
          <p className="incdetail__eyebrow">
            <span className="mono">{incident.incident_id}</span>
            <span className={`tag ${incident.status === 'active' ? 'tag--live' : ''}`}>{incident.status === 'active' ? 'Active' : 'Resolved'}</span>
          </p>
          <h2 className="incdetail__title">{INCIDENT_TYPE_LABEL[incident.type]}</h2>
          <p className="incdetail__meta">
            {seg?.name ?? incident.segment_id} <span className="mono muted">{incident.segment_id}</span> · detected {fmtDateTime(incident.detected_at)} IST
          </p>
        </div>
        <SeverityBadge severity={incident.severity} />
      </header>

      <Notice title="Simulated anomaly" icon={FlaskConical}>
        Found in simulated telemetry by the incident detector. It is a pattern, not a verified accident.
      </Notice>

      <p className="incdetail__reason">{incident.reason}</p>

      <div className="grid grid--2">
        <section aria-label="Evidence">
          <h3 className="segdetail__h">Evidence</h3>
          <table className="table table--compact">
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col" className="num-col">Usual</th>
                <th scope="col" className="num-col">Observed</th>
                <th scope="col" className="num-col">Change</th>
              </tr>
            </thead>
            <tbody>
              {incident.evidence.map((e) => (
                <tr key={e.metric}>
                  <td>{e.label}</td>
                  <td className="num-col num">
                    {fmtNum(e.baseline)} <span className="muted">{e.unit}</span>
                  </td>
                  <td className="num-col num">
                    {fmtNum(e.observed)} <span className="muted">{e.unit}</span>
                  </td>
                  <td className="num-col num">{change(e.baseline, e.observed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="segdetail__h">Conditions at detection</h3>
          <dl className="glance glance--wide">
            <div>
              <dt>Level</dt>
              <dd>
                <LevelBadge level={incident.conditions.level} size="sm" />
              </dd>
            </div>
            <div>
              <dt>Speed</dt>
              <dd className="num">{fmtSpeed(incident.conditions.avg_speed_kph)} km/h</dd>
            </div>
            <div>
              <dt>Vehicles</dt>
              <dd className="num">{fmtInt(incident.conditions.vehicle_count)}</dd>
            </div>
            <div>
              <dt>Density</dt>
              <dd className="num">{fmtOne(incident.conditions.density_veh_per_km)} veh/km</dd>
            </div>
            <div>
              <dt>Flow</dt>
              <dd className="num">{fmtInt(incident.conditions.flow_veh_per_h)} veh/h</dd>
            </div>
          </dl>
        </section>
        <section aria-label="Affected area">
          <h3 className="segdetail__h">Affected area</h3>
          <div className="incdetail__map">
            <TrafficMap
              ariaLabel={`Map of the segments affected by incident ${incident.incident_id}`}
              selectedSegment={incident.segment_id}
              showVehicles={false}
              incidents={incident.status === 'active' ? [incident] : []}
              focus={focus}
              padding={{ top: 48, right: 48, bottom: 48, left: 48 }}
            />
          </div>
          <ul className="chips">
            {incident.affected_segments.map((id) => (
              <li key={id} className="chip">
                {segIndex[id]?.name ?? id} <span className="mono muted">{id}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-label="Timeline">
        <h3 className="segdetail__h">Timeline</h3>
        <ol className="timeline">
          {incident.timeline.map((t) => (
            <li key={`${t.ts}-${t.kind}`} className={`timeline__item timeline__item--${t.kind}`}>
              <span className="timeline__dot" aria-hidden="true" />
              <p className="timeline__head">
                <strong>{t.kind[0].toUpperCase() + t.kind.slice(1)}</strong> <span className="num muted">{fmtTime(t.ts)} IST</span>
              </p>
              <p className="soft">{t.note}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default function Incidents() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusFilter>('all');
  const incidents = useLive((s) => s.incidents);
  const segIndex = useLive((s) => s.segIndex);
  const now = useNow(10_000);
  const q = useIncident(id && !incidents[id] ? id : null);

  const list = useMemo(
    () =>
      Object.values(incidents)
        .filter((i) => status === 'all' || i.status === status)
        .sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1) || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.detected_at.localeCompare(a.detected_at)),
    [incidents, status],
  );
  const current = (id ? incidents[id] ?? q.data : list[0]) ?? null;
  const activeCount = Object.values(incidents).filter((i) => i.status === 'active').length;

  return (
    <div className="stack">
      <div className="filters enter" style={{ '--i': 0 } as React.CSSProperties}>
        <Segmented<StatusFilter>
          label="Show incidents"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: `Active (${activeCount})` },
            { value: 'resolved', label: 'Resolved' },
          ]}
        />
        <p className="filters__note muted">Detected by the incident-detector transform on Condense from segment windows.</p>
      </div>
      <div className="grid grid--list-detail">
        <Panel title="Feed" meta={`${list.length} shown`} enter={40} bodyClassName="panel__body--flush">
          {list.length ? (
            <ul className="incfeed">
              <AnimatePresence initial={false}>
                {list.map((i) => (
                  <motion.li
                    key={i.incident_id}
                    layout="position"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22, ease: EASE_OUT }}
                  >
                    <Link
                      to={`/incidents/${i.incident_id}`}
                      className={`incfeed__item ${current?.incident_id === i.incident_id ? 'is-selected' : ''} ${i.status === 'resolved' ? 'is-resolved' : ''}`}
                      aria-current={current?.incident_id === i.incident_id ? 'true' : undefined}
                    >
                      <span className="incfeed__top">
                        <SeverityBadge severity={i.severity} size="sm" />
                        <span className="num muted">{i.status === 'active' ? fmtAgo(i.detected_at, now) : 'Resolved'}</span>
                      </span>
                      <span className="incfeed__title">{INCIDENT_TYPE_LABEL[i.type]}</span>
                      <span className="incfeed__seg">
                        {segIndex[i.segment_id]?.name ?? i.segment_id} <span className="mono muted">{i.segment_id}</span>
                      </span>
                    </Link>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          ) : (
            <Empty title={status === 'active' ? 'No active incidents' : 'No incidents'}>Incidents appear when the detector sees an abnormal pattern.</Empty>
          )}
        </Panel>
        <Panel enter={80}>
          {current ? (
            <IncidentDetail incident={current} />
          ) : id && q.isError ? (
            <Notice tone="warn" title="Incident not found" action={<button className="btn" onClick={() => navigate('/incidents')}>Back to the feed</button>}>
              {(q.error as Error).message}
            </Notice>
          ) : id && q.isLoading ? (
            <div className="skeleton" style={{ height: 420 }} />
          ) : (
            <Empty title="Pick an incident">Its evidence, affected roads and timeline show here.</Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}
