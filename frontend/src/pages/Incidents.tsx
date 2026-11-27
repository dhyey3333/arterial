import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { FlaskConical } from 'lucide-react';
import { TrafficMap } from '../components/map/TrafficMap';
import { Empty, KeyValue, LevelBadge, Notice, Segmented, SeverityBadge, useNow } from '../components/ui/primitives';
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

function IncidentDoc({ incident }: { incident: Incident }) {
  const segIndex = useLive((s) => s.segIndex);
  const seg = segIndex[incident.segment_id];
  const focus = useMemo(() => [incident.segment_id, ...incident.affected_segments], [incident]);
  return (
    <motion.div
      className="doc"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT }}
    >
      <header className="doc__head">
        <p className="doc__eyebrow">
          <span className="mono">{incident.incident_id}</span>
          <span className={`tag ${incident.status === 'active' ? 'tag--live' : ''}`}>{incident.status === 'active' ? 'Active' : 'Resolved'}</span>
          <SeverityBadge severity={incident.severity} size="sm" />
        </p>
        <h2 className="doc__title">{INCIDENT_TYPE_LABEL[incident.type]}</h2>
        <p className="doc__where">
          {seg?.name ?? incident.segment_id} <span className="mono muted">{incident.segment_id}</span>
          <span className="muted"> · detected {fmtDateTime(incident.detected_at)} IST</span>
        </p>
      </header>

      <p className="doc__reason">{incident.reason}</p>

      <Notice title="Simulated anomaly" icon={FlaskConical}>
        Found in simulated telemetry by the incident detector. It is a pattern, not a verified accident.
      </Notice>

      <section className="doc__block" aria-label="Evidence">
        <h3 className="doc__h">Evidence</h3>
        <table className="table doc__evidence">
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
                <td className="num-col num doc__change">{change(e.baseline, e.observed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="doc__block" aria-label="Affected area">
        <h3 className="doc__h">Affected area</h3>
        <div className="doc__map">
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

      <div className="split split--even doc__pair">
        <section className="doc__block" aria-label="Conditions at detection">
          <h3 className="doc__h">Conditions at detection</h3>
          <KeyValue
            items={[
              { k: 'Level', v: <LevelBadge level={incident.conditions.level} size="sm" /> },
              { k: 'Speed', v: <span className="num">{fmtSpeed(incident.conditions.avg_speed_kph)} km/h</span> },
              { k: 'Vehicles', v: <span className="num">{fmtInt(incident.conditions.vehicle_count)}</span> },
              { k: 'Density', v: <span className="num">{fmtOne(incident.conditions.density_veh_per_km)} veh/km</span> },
              { k: 'Flow', v: <span className="num">{fmtInt(incident.conditions.flow_veh_per_h)} veh/h</span> },
            ]}
          />
        </section>
        <section className="doc__block" aria-label="Timeline">
          <h3 className="doc__h">Timeline</h3>
          <ol className="timeline">
            {incident.timeline.map((t) => (
              <li key={`${t.ts}-${t.kind}`} className={`timeline__item timeline__item--${t.kind}`}>
                <span className="timeline__dot" aria-hidden="true" />
                <p className="timeline__head">
                  <strong>{t.kind[0].toUpperCase() + t.kind.slice(1)}</strong> <span className="num muted">{fmtTime(t.ts)} IST</span>
                </p>
                <p className="timeline__note">{t.note}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </motion.div>
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
    <div className="inbox">
      <aside className="inbox__list" aria-label="Incident feed">
        <header className="inbox__head enter">
          <h1 className="phead__title">Incidents</h1>
          <p className="phead__lede">Abnormal patterns found in the simulated stream, with the evidence for each</p>
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
        </header>
        {list.length ? (
          <ul className="rows inbox__feed">
            <AnimatePresence initial={false}>
              {list.map((i) => {
                const isCurrent = current?.incident_id === i.incident_id;
                return (
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
                      className={`row inbox-item ${isCurrent ? 'is-selected' : ''} ${i.status === 'resolved' ? 'is-resolved' : ''}`}
                      aria-current={isCurrent ? 'true' : undefined}
                    >
                      <SeverityBadge severity={i.severity} size="sm" />
                      <span className="row__meta num">{i.status === 'active' ? fmtAgo(i.detected_at, now) : 'Resolved'}</span>
                      <span className="row__title inbox-item__title">{INCIDENT_TYPE_LABEL[i.type]}</span>
                      <span className="row__sub inbox-item__seg">
                        {segIndex[i.segment_id]?.name ?? i.segment_id} <span className="mono">{i.segment_id}</span>
                      </span>
                    </Link>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        ) : (
          <div className="inbox__empty">
            <Empty title={status === 'active' ? 'No active incidents' : 'No incidents'}>Incidents appear when the detector sees an abnormal pattern.</Empty>
          </div>
        )}
        <p className="inbox__foot">Detected by the incident-detector transform on Condense, from closed segment windows.</p>
      </aside>

      <article className="inbox__doc" aria-label="Incident">
        {current ? (
          <IncidentDoc incident={current} />
        ) : id && q.isError ? (
          <div className="doc">
            <Notice tone="warn" title="Incident not found" action={<button className="btn" onClick={() => navigate('/incidents')}>Back to the feed</button>}>
              {(q.error as Error).message}
            </Notice>
          </div>
        ) : id && q.isLoading ? (
          <div className="doc">
            <div className="skeleton" style={{ height: 420 }} />
          </div>
        ) : (
          <div className="doc">
            <Empty title="Pick an incident">Its evidence, affected roads and timeline show here.</Empty>
          </div>
        )}
      </article>
    </div>
  );
}
