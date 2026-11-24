import { useMemo, useState } from 'react';
import { LineChart, type Point } from '../components/charts/charts';
import { TrafficMap } from '../components/map/TrafficMap';
import { Empty, LevelBadge, Notice, Panel, Segmented } from '../components/ui/primitives';
import { useModelInfo } from '../data/queries';
import { useLive } from '../data/store';
import { LEVEL_RANK, fmtDateTime, fmtInt, fmtOne, fmtShortTime, fmtSigned, fmtSpeed } from '../lib/format';

const HORIZONS = [5, 10, 15] as const;

function ModelCard() {
  const live = useLive((s) => s.predictions?.model);
  const q = useModelInfo();
  const model = q.data ?? live;
  if (!model) {
    return (
      <Panel title="Model" enter={160}>
        {q.isError ? <Notice tone="warn" title="Model details unavailable">{(q.error as Error).message}</Notice> : <div className="skeleton" style={{ height: 180 }} />}
      </Panel>
    );
  }
  return (
    <Panel
      title="Model"
      meta={
        <>
          <span className={`tag ${model.kind === 'rule_baseline' ? '' : 'tag--accent'}`}>{model.kind === 'rule_baseline' ? 'Rule-based baseline' : 'Trained model'}</span>{' '}
          <span className="mono">{model.name} {model.version}</span>
        </>
      }
      enter={160}
    >
      <p className="soft model__desc">{model.description}</p>
      {model.evaluation.length ? (
        <>
          <table className="table table--compact">
            <caption className="table__caption">Error on held-out windows, km/h. Lower is better. Persistence assumes speed stays as it is now.</caption>
            <thead>
              <tr>
                <th scope="col">Horizon</th>
                <th scope="col" className="num-col">MAE</th>
                <th scope="col" className="num-col">RMSE</th>
                <th scope="col" className="num-col">Persistence MAE</th>
                <th scope="col" className="num-col">Windows</th>
              </tr>
            </thead>
            <tbody>
              {model.evaluation.map((e) => (
                <tr key={e.horizon_min}>
                  <td className="num">{e.horizon_min} min</td>
                  <td className="num-col num">{fmtOne(e.mae_kph)}</td>
                  <td className="num-col num">{fmtOne(e.rmse_kph)}</td>
                  <td className="num-col num">
                    {fmtOne(e.baseline_mae_kph)}{' '}
                    <span className={e.mae_kph < e.baseline_mae_kph ? 'good' : 'bad'}>
                      ({e.mae_kph < e.baseline_mae_kph ? 'beaten' : 'not beaten'})
                    </span>
                  </td>
                  <td className="num-col num muted">{fmtInt(e.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            Evaluated {fmtDateTime(model.evaluated_at)} IST
            {model.trained_at ? ` · trained ${fmtDateTime(model.trained_at)} IST on ${fmtInt(model.training_windows)} windows` : ''}
          </p>
        </>
      ) : (
        <Empty title="Not evaluated yet">MAE and RMSE appear once there is held-out history to score against.</Empty>
      )}
      <p className="muted small">
        The risk score is the share of the forecast range that falls below the heavy-traffic speed. It ranks segments; it is not a
        probability.
      </p>
    </Panel>
  );
}

export default function Forecast() {
  const [horizon, setHorizon] = useState<number>(10);
  const [picked, setPicked] = useState<string | null>(null);
  const predictions = useLive((s) => s.predictions);
  const states = useLive((s) => s.states);
  const segIndex = useLive((s) => s.segIndex);
  const history = useLive((s) => s.speedHistory);

  const ranked = useMemo(() => {
    if (!predictions) return [];
    return predictions.predictions
      .filter((p) => p.horizon_min === horizon)
      .map((p) => ({ p, now: states[p.segment_id]?.level ?? 'no_data' }))
      .sort((a, b) => b.p.risk - a.p.risk || a.p.expected_change_kph - b.p.expected_change_kph);
  }, [predictions, states, horizon]);

  const worse = ranked.filter((r) => LEVEL_RANK[r.p.predicted_level] > LEVEL_RANK[r.now]);
  const selected = picked ?? ranked[0]?.p.segment_id ?? null;
  const seg = selected ? segIndex[selected] : null;

  const chart = useMemo(() => {
    if (!selected || !predictions) return null;
    const obs: Point[] = (history[selected] ?? []).map((h) => ({ t: h.t, v: h.v }));
    const steps = predictions.predictions.filter((p) => p.segment_id === selected).sort((a, b) => a.horizon_min - b.horizon_min);
    const lastT = obs.length ? obs[obs.length - 1].t : new Date(predictions.made_at).getTime();
    const lastV = obs.length ? obs[obs.length - 1].v : steps[0]?.current_speed_kph ?? null;
    return { obs, steps, lastT, lastV };
  }, [selected, predictions, history]);

  return (
    <div className="stack">
      <div className="filters enter" style={{ '--i': 0 } as React.CSSProperties}>
        <Segmented<number>
          label="Forecast horizon"
          value={horizon}
          onChange={setHorizon}
          options={HORIZONS.map((h) => ({ value: h, label: `${h} min` }))}
        />
        <p className="filters__note muted">
          {predictions ? (
            <>
              <span className="num">{worse.length}</span> of {ranked.length} segments forecast to get worse · made {fmtShortTime(predictions.made_at)} IST
            </>
          ) : (
            'Waiting for the first forecast'
          )}
        </p>
      </div>

      <div className="grid grid--2-1">
        <div className="panel panel--map enter" style={{ '--i': 40 } as React.CSSProperties}>
          <TrafficMap
            ariaLabel={`Forecast map: each segment coloured by its forecast level in ${horizon} minutes`}
            mode="forecast"
            horizon={horizon}
            selectedSegment={selected}
            onSelectSegment={(id) => id && setPicked(id)}
            showVehicles={false}
            showLegend
            padding={{ top: 40, right: 40, bottom: 64, left: 40 }}
          />
        </div>
        <Panel title={`Highest risk in ${horizon} min`} meta="Sorted by risk score, then by expected speed drop" enter={70} bodyClassName="panel__body--flush">
          {ranked.length ? (
            <ul className="rankl">
              {ranked.slice(0, 10).map(({ p, now }) => (
                <li key={p.segment_id}>
                  <button type="button" className={`rankl__item ${selected === p.segment_id ? 'is-selected' : ''}`} onClick={() => setPicked(p.segment_id)} aria-pressed={selected === p.segment_id}>
                    <span className="rankl__name">
                      {segIndex[p.segment_id]?.name ?? p.segment_id}
                      <span className="mono muted">{p.segment_id}</span>
                    </span>
                    <span className="rankl__levels">
                      <LevelBadge level={now} size="sm" />
                      <span aria-hidden="true" className="muted">→</span>
                      <span className="visually-hidden">to</span>
                      <LevelBadge level={p.predicted_level} size="sm" />
                    </span>
                    <span className="rankl__nums num">
                      <span>
                        {fmtSpeed(p.current_speed_kph)} → {fmtSpeed(p.predicted_speed_kph)} km/h
                      </span>
                      <span className="muted">
                        range {fmtSpeed(p.interval_kph[0])}–{fmtSpeed(p.interval_kph[1])}
                      </span>
                    </span>
                    <span className="riskbar riskbar--wide" aria-label={`Risk score ${Math.round(p.risk * 100)} of 100`}>
                      <span className="riskbar__fill" style={{ transform: `scaleX(${p.risk})` }} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No forecast yet">Forecasts arrive with each closed window.</Empty>
          )}
        </Panel>
      </div>

      <div className="grid grid--2-1">
        <Panel
          title={seg ? `${seg.name}: observed and forecast speed` : 'Observed and forecast speed'}
          meta={seg ? <span className="mono">{seg.id}</span> : undefined}
          enter={110}
        >
          {chart && seg && chart.obs.length + chart.steps.length > 1 ? (
            <>
              <LineChart
                title={`Observed and forecast speed on ${seg.name}`}
                unit="km/h"
                yMin={0}
                height={260}
                series={[
                  { id: 'obs', label: 'Observed', color: 'var(--series-1)', points: chart.obs.length ? chart.obs : [{ t: chart.lastT, v: chart.lastV }] },
                  {
                    id: 'ff',
                    label: 'Free flow',
                    color: 'var(--ink-3)',
                    quiet: true,
                    points: [
                      { t: chart.obs[0]?.t ?? chart.lastT, v: seg.free_flow_kph },
                      { t: chart.lastT + 15 * 60_000, v: seg.free_flow_kph },
                    ],
                  },
                ]}
                band={{
                  label: 'Forecast range',
                  color: 'var(--signal)',
                  points: [
                    { t: chart.lastT, lo: chart.lastV ?? 0, hi: chart.lastV ?? 0 },
                    ...chart.steps.map((p) => ({ t: chart.lastT + p.horizon_min * 60_000, lo: p.interval_kph[0], hi: p.interval_kph[1] })),
                  ],
                }}
                dots={chart.steps.map((p) => ({ t: chart.lastT + p.horizon_min * 60_000, v: p.predicted_speed_kph, color: 'var(--signal)', label: `${p.horizon_min} min` }))}
                marker={{ t: chart.lastT, label: 'now' }}
              />
              <div className="steps">
                {chart.steps.map((p) => (
                  <div key={p.horizon_min} className={`steps__item ${p.horizon_min === horizon ? 'is-current' : ''}`}>
                    <p className="steps__h">In {p.horizon_min} min</p>
                    <LevelBadge level={p.predicted_level} size="sm" />
                    <p className="num">
                      {fmtSpeed(p.predicted_speed_kph)} km/h <span className="muted">({fmtSigned(p.expected_change_kph)})</span>
                    </p>
                  </div>
                ))}
              </div>
              {chart.steps[chart.steps.length - 1]?.drivers.length ? (
                <ul className="drivers">
                  {chart.steps[chart.steps.length - 1].drivers.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <Empty title="Pick a segment">Choose one from the list or the map.</Empty>
          )}
        </Panel>
        <ModelCard />
      </div>
    </div>
  );
}
