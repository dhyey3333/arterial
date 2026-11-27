import { Suspense, lazy, useMemo, useState } from 'react';
import { LineChart, type Point } from '../components/charts/charts';
import { TrafficMap } from '../components/map/TrafficMap';
import { Empty, LevelBadge, LevelSwatch, Notice, PageHead, Section, Segmented } from '../components/ui/primitives';
import { useModelInfo } from '../data/queries';
import { useLive } from '../data/store';
import { LEVEL_LABEL, LEVEL_RANK, fmtDateTime, fmtInt, fmtOne, fmtShortTime, fmtSigned, fmtSpeed } from '../lib/format';

const HORIZONS = [5, 10, 15] as const;

// The 3D time stack loads only when someone asks for it: three.js stays out of the page until then.
const ForecastStack = lazy(() => import('../components/stack/ForecastStack'));
type View = 'map' | 'stack';

function ModelSpec() {
  const live = useLive((s) => s.predictions?.model);
  const q = useModelInfo();
  const model = q.data ?? live;
  if (!model) {
    return (
      <Section title="Model" enter={200}>
        {q.isError ? <Notice tone="warn" title="Model details unavailable">{(q.error as Error).message}</Notice> : <div className="skeleton" style={{ height: 160 }} />}
      </Section>
    );
  }
  return (
    <Section
      title="Model"
      meta={<span className="mono">{model.name} {model.version}</span>}
      actions={<span className={`tag ${model.kind === 'rule_baseline' ? '' : 'tag--accent'}`}>{model.kind === 'rule_baseline' ? 'Rule-based baseline' : 'Trained model'}</span>}
      enter={200}
    >
      <p className="fc__model-desc">{model.description}</p>
      {model.evaluation.length ? (
        <table className="table table--compact fc__eval">
          <caption className="table__caption">
            Error on held-out windows in km/h; lower is better. Persistence assumes the speed stays as it is now. Evaluated{' '}
            {fmtDateTime(model.evaluated_at)} IST
            {model.trained_at ? `, trained ${fmtDateTime(model.trained_at)} IST on ${fmtInt(model.training_windows)} windows` : ''}.
          </caption>
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
                  <span className={e.mae_kph < e.baseline_mae_kph ? 'good' : 'bad'}>{e.mae_kph < e.baseline_mae_kph ? 'beaten' : 'not beaten'}</span>
                </td>
                <td className="num-col num muted">{fmtInt(e.n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty title="Not evaluated yet">MAE and RMSE appear once there is held-out history to score against.</Empty>
      )}
      <p className="fc__fine">
        The risk score is the share of the forecast range that falls below the heavy-traffic speed. It ranks segments; it is not a probability.
      </p>
    </Section>
  );
}

export default function Forecast() {
  const [horizon, setHorizon] = useState<number>(10);
  const [picked, setPicked] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [view, setView] = useState<View>('map');
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
    <div className="fc">
      <div className={`fc__map enter ${view === 'stack' ? 'is-stack' : ''}`} style={{ '--i': 0 } as React.CSSProperties}>
        <TrafficMap
          ariaLabel={`Forecast map: each segment coloured by its forecast level in ${horizon} minutes`}
          mode="forecast"
          horizon={horizon}
          selectedSegment={selected}
          hoverSegment={hovered}
          onSelectSegment={(id) => id && setPicked(id)}
          showVehicles={false}
          showLegend
          padding={{ top: 72, right: 48, bottom: 72, left: 48 }}
        />
        {view === 'stack' && (
          <div className="fc__stack">
            <Suspense fallback={<div className="stk__loading">Loading the time stack…</div>}>
              <ForecastStack horizon={horizon} selected={selected} hovered={hovered} onSelect={setPicked} onHover={setHovered} />
            </Suspense>
          </div>
        )}
        <div className="fc__mapbar">
          <Segmented<View>
            label="Forecast view"
            className="float"
            value={view}
            onChange={setView}
            options={[
              { value: 'map', label: 'Map' },
              { value: 'stack', label: 'Time stack' },
            ]}
          />
          <div className="fc__mapnote float">
            <span className="fc__mapnote-dot" aria-hidden="true" />
            {view === 'map' ? (
              <>
                Map shows the forecast in <strong className="num">{horizon} min</strong>
              </>
            ) : (
              <>
                Now at the bottom, <strong className="num">+15 min</strong> on top · drag to turn
              </>
            )}
          </div>
        </div>
      </div>

      <div className="fc__read">
        <PageHead title="Forecast" lede="Where traffic is likely to slow in the next 5 to 15 minutes, and how sure the model is">
          <Segmented<number> label="Forecast horizon" value={horizon} onChange={setHorizon} options={HORIZONS.map((h) => ({ value: h, label: `${h} min` }))} />
        </PageHead>

        <div className="fc__body">
          <p className="fc__lead enter" style={{ '--i': 60 } as React.CSSProperties}>
            {predictions ? (
              <>
                <strong className="num">{worse.length}</strong> of {ranked.length} segments are forecast to get worse in the next{' '}
                <strong className="num">{horizon} minutes</strong>.
                <span className="fc__lead-meta num"> Made {fmtShortTime(predictions.made_at)} IST.</span>
              </>
            ) : (
              'Waiting for the first forecast.'
            )}
          </p>

          <Section title={`Highest risk in ${horizon} min`} meta="Sorted by risk score, then by the expected drop in speed" enter={100}>
            {ranked.length ? (
              <ol className="rows fc__ranks swap-in" key={horizon} onPointerLeave={() => setHovered(null)}>
                {ranked.slice(0, 8).map(({ p, now }, i) => (
                  <li key={p.segment_id}>
                    <button
                      type="button"
                      className={`row fc-rank ${selected === p.segment_id ? 'is-selected' : ''}`}
                      onClick={() => setPicked(p.segment_id)}
                      onPointerEnter={() => setHovered(p.segment_id)}
                      onFocus={() => setHovered(p.segment_id)}
                      onBlur={() => setHovered(null)}
                      aria-pressed={selected === p.segment_id}
                    >
                      <span className="fc-rank__n num">{i + 1}</span>
                      <span className="row__title">
                        {segIndex[p.segment_id]?.name ?? p.segment_id} <span className="mono muted">{p.segment_id}</span>
                      </span>
                      <span className="fc-rank__speed num">
                        {fmtSpeed(p.current_speed_kph)} <span className="transition__arrow">→</span> {fmtSpeed(p.predicted_speed_kph)}
                        <span className="muted"> km/h</span>
                      </span>
                      <span className="transition fc-rank__levels">
                        <LevelSwatch level={now} />
                        <span className="soft">{LEVEL_LABEL[now]}</span>
                        <span className="transition__arrow" aria-hidden="true">→</span>
                        <span className="visually-hidden">to</span>
                        <LevelSwatch level={p.predicted_level} />
                        <span>{LEVEL_LABEL[p.predicted_level]}</span>
                        <span className="muted num fc-rank__range">
                          range {fmtSpeed(p.interval_kph[0])}–{fmtSpeed(p.interval_kph[1])}
                        </span>
                      </span>
                      <span className="meter fc-rank__meter" role="img" aria-label={`Risk score ${Math.round(p.risk * 100)} of 100`}>
                        <span className="meter__fill" style={{ transform: `scaleX(${p.risk})`, background: `var(--level-${p.predicted_level})` }} />
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty title="No forecast yet">Forecasts arrive with each closed window.</Empty>
            )}
          </Section>

          <Section title={seg ? seg.name : 'Observed and forecast speed'} meta={seg ? <>Observed and forecast speed · <span className="mono">{seg.id}</span></> : undefined} enter={150}>
            {chart && seg && chart.obs.length + chart.steps.length > 1 ? (
              <>
                <LineChart
                  title={`Observed and forecast speed on ${seg.name}`}
                  unit="km/h"
                  yMin={0}
                  height={240}
                  series={[
                    { id: 'obs', label: 'Observed', color: 'var(--series-1)', points: chart.obs.length ? chart.obs : [{ t: chart.lastT, v: chart.lastV }], area: true },
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
                <div className="fc-steps">
                  {chart.steps.map((p) => (
                    <div key={p.horizon_min} className={`fc-steps__item ${p.horizon_min === horizon ? 'is-current' : ''}`}>
                      <p className="fc-steps__h">In {p.horizon_min} min</p>
                      <p className="fc-steps__v num">
                        {fmtSpeed(p.predicted_speed_kph)}
                        <span className="muted"> km/h</span>
                      </p>
                      <p className="fc-steps__d">
                        <LevelBadge level={p.predicted_level} size="sm" />
                        <span className="muted num">{fmtSigned(p.expected_change_kph)} km/h</span>
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
          </Section>

          <ModelSpec />
        </div>
      </div>
    </div>
  );
}
