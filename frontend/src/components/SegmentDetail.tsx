import { X } from 'lucide-react';
import { Link } from 'react-router';
import { useMemo } from 'react';
import { useSegmentDetail } from '../data/queries';
import { useLive } from '../data/store';
import { INCIDENT_TYPE_LABEL, LEVEL_LABEL, TREND_LABEL, fmtInt, fmtOne, fmtPct, fmtShortTime, fmtSigned, fmtSpeed, fmtDistance, fmtTime } from '../lib/format';
import { LineChart, type Point } from './charts/charts';
import { CopyId, Empty, KeyValue, LevelBadge, Notice, SeverityBadge } from './ui/primitives';

export function TrendMark({ trend, slope }: { trend: 'improving' | 'stable' | 'worsening'; slope: number }) {
  return (
    <span className={`trend trend--${trend}`}>
      <span className="trend__arrow" aria-hidden="true">
        {trend === 'worsening' ? '↘' : trend === 'improving' ? '↗' : '→'}
      </span>
      {TREND_LABEL[trend]}
      <span className="num muted">{fmtSigned(slope, 1)} km/h/min</span>
    </span>
  );
}

export function SegmentDetail({ id, onClose }: { id: string; onClose?: () => void }) {
  const seg = useLive((s) => s.segIndex[id]);
  const live = useLive((s) => s.states[id]);
  const liveHistory = useLive((s) => s.speedHistory[id]);
  const preds = useLive((s) => s.predictions);
  const q = useSegmentDetail(id);

  const state = live ?? q.data?.state ?? null;
  const forecasts = useMemo(
    () => (preds?.predictions.filter((p) => p.segment_id === id) ?? q.data?.predictions ?? []).sort((a, b) => a.horizon_min - b.horizon_min),
    [preds, q.data, id],
  );

  const observed: Point[] = useMemo(() => {
    const map = new Map<number, number | null>();
    for (const h of q.data?.history ?? []) map.set(new Date(h.window_end).getTime(), h.avg_speed_kph);
    for (const h of liveHistory ?? []) map.set(h.t, h.v);
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }));
  }, [q.data, liveHistory]);

  if (!seg) return <Empty title="Unknown segment">This segment is not in the road network.</Empty>;

  const lastT = observed.length ? observed[observed.length - 1].t : Date.now();
  const firstT = observed.length ? observed[0].t : lastT - 20 * 60_000;
  const ff = seg.free_flow_kph;
  const band = forecasts.length
    ? {
        label: 'Forecast range',
        color: 'var(--signal)',
        points: [
          { t: lastT, lo: observed[observed.length - 1]?.v ?? forecasts[0].interval_kph[0], hi: observed[observed.length - 1]?.v ?? forecasts[0].interval_kph[1] },
          ...forecasts.map((p) => ({ t: lastT + p.horizon_min * 60_000, lo: p.interval_kph[0], hi: p.interval_kph[1] })),
        ],
      }
    : undefined;
  const incidents = q.data?.incidents ?? [];

  return (
    <div className="segdetail">
      <header className="segdetail__head">
        <div>
          <p className="segdetail__eyebrow">
            <CopyId value={seg.id} label="segment id" />
          </p>
          <h2 className="segdetail__title">{seg.name}</h2>
          <p className="segdetail__meta">
            {fmtDistance(seg.length_m)} · {seg.lanes} lanes · limit {seg.speed_limit_kph} km/h · free flow {ff} km/h
          </p>
        </div>
        {onClose && (
          <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Close segment details">
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </header>

      {state ? (
        <>
          <div className="segdetail__level">
            <LevelBadge level={state.level} />
            <TrendMark trend={state.trend} slope={state.trend_kph_per_min} />
          </div>
          <p className="segdetail__reason">{state.reason}</p>
          <div className="segdetail__metrics">
            <div>
              <p className="metric__label">Speed</p>
              <p className="metric__value num">
                {fmtSpeed(state.avg_speed_kph)}
                <span className="metric__unit">km/h</span>
              </p>
            </div>
            <div>
              <p className="metric__label">Below free flow</p>
              <p className="metric__value num">{fmtPct(state.speed_reduction_pct)}</p>
            </div>
            <div>
              <p className="metric__label">Density</p>
              <p className="metric__value num">
                {fmtOne(state.density_veh_per_km)}
                <span className="metric__unit">veh/km</span>
              </p>
            </div>
            <div>
              <p className="metric__label">Flow</p>
              <p className="metric__value num">
                {fmtInt(state.flow_veh_per_h)}
                <span className="metric__unit">veh/h</span>
              </p>
            </div>
          </div>
        </>
      ) : (
        <Notice title="No window yet">No closed 30-second window has reached the app for this segment.</Notice>
      )}

      <section className="segdetail__section" aria-label="Speed and forecast">
        <h3 className="segdetail__h">Speed, last {Math.max(1, Math.round((lastT - firstT) / 60_000))} min and next 15</h3>
        {observed.length > 1 ? (
          <LineChart
            title={`Speed on ${seg.name}`}
            unit="km/h"
            height={190}
            yMin={0}
            series={[
              { id: 'obs', label: 'Observed', color: 'var(--series-1)', points: observed },
              {
                id: 'ff',
                label: 'Free flow',
                color: 'var(--ink-3)',
                quiet: true,
                points: [
                  { t: firstT, v: ff },
                  { t: lastT + 15 * 60_000, v: ff },
                ],
              },
            ]}
            band={band}
            dots={forecasts.map((p) => ({ t: lastT + p.horizon_min * 60_000, v: p.predicted_speed_kph, color: 'var(--signal)', label: `${p.horizon_min} min` }))}
            marker={{ t: lastT, label: 'now' }}
          />
        ) : q.isLoading ? (
          <div className="skeleton" style={{ height: 190 }} />
        ) : (
          <Empty title="Not enough windows yet">The chart starts after two closed windows.</Empty>
        )}
      </section>

      <section className="segdetail__section" aria-label="Forecast">
        <h3 className="segdetail__h">Forecast</h3>
        {forecasts.length ? (
          <table className="table table--compact">
            <thead>
              <tr>
                <th scope="col">In</th>
                <th scope="col">Level</th>
                <th scope="col" className="num-col">Speed</th>
                <th scope="col" className="num-col">Range</th>
              </tr>
            </thead>
            <tbody>
              {forecasts.map((p) => (
                <tr key={p.horizon_min}>
                  <td className="num">{p.horizon_min} min</td>
                  <td>
                    <LevelBadge level={p.predicted_level} size="sm" />
                  </td>
                  <td className="num-col num">
                    {fmtSpeed(p.predicted_speed_kph)} <span className="muted">({fmtSigned(p.expected_change_kph)})</span>
                  </td>
                  <td className="num-col num muted">
                    {fmtSpeed(p.interval_kph[0])}–{fmtSpeed(p.interval_kph[1])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title="No forecast for this segment yet" />
        )}
        {forecasts[0]?.drivers.length ? (
          <ul className="drivers">
            {forecasts[forecasts.length - 1].drivers.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        ) : null}
      </section>

      {incidents.length > 0 && (
        <section className="segdetail__section" aria-label="Incidents on this segment">
          <h3 className="segdetail__h">Incidents</h3>
          <ul className="minilist">
            {incidents.map((i) => (
              <li key={i.incident_id}>
                <Link to={`/incidents/${i.incident_id}`} className="minilist__link">
                  <SeverityBadge severity={i.severity} size="sm" />
                  <span className="minilist__main">{INCIDENT_TYPE_LABEL[i.type]}</span>
                  <span className="muted num">{i.status === 'active' ? 'Active' : `Resolved ${fmtShortTime(i.resolved_at)}`}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {state && (
        <KeyValue
          items={[
            { k: 'Window', v: <span className="num">{fmtTime(state.window_start)}–{fmtTime(state.window_end)}</span> },
            { k: 'Vehicles in window', v: <span className="num">{fmtInt(state.vehicle_count)}</span> },
            { k: 'Severity score', v: <span className="num">{fmtInt(state.severity)} / 100</span> },
            { k: 'Level', v: LEVEL_LABEL[state.level] },
          ]}
        />
      )}
    </div>
  );
}
