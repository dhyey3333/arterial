import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { LevelSwatch } from '../components/ui/primitives';
import { useAtRisk } from '../data/derived';
import { useLive } from '../data/store';
import { LEVEL_LABEL, fmtSigned, fmtTime } from '../lib/format';

/**
 * The hero's product panel: the console's own "Likely to slow in 10 min" list, live, floating over the
 * network like a window of the running software. Same rows as the console (one shared selector), the
 * same risk meter, the forecast's time and model in mono underneath. With no forecast it says so.
 */
export function HeroPanel() {
  const predictions = useLive((s) => s.predictions);
  const states = useLive((s) => s.states);
  const segIndex = useLive((s) => s.segIndex);
  const network = useLive((s) => s.network);
  const rows = useAtRisk(10, 3);
  const total = network?.segments.length ?? 21;

  return (
    <aside className="lp-panel lp-rise" style={{ '--i': 6 } as React.CSSProperties} aria-labelledby="lp-panel-h">
      <div className="lp-panel__head">
        <h2 id="lp-panel-h" className="lp-panel__title">
          Likely to slow <span className="lp-panel__when">in 10 min</span>
        </h2>
        <span className="lp-panel__count num">{predictions ? `${rows.length} of ${total}` : '—'}</span>
      </div>
      {!predictions ? (
        <p className="lp-panel__empty">Forecasts arrive with each closed window.</p>
      ) : rows.length ? (
        <ol className="lp-panel__rows">
          {rows.map((p) => {
            const now = states[p.segment_id]?.level ?? 'no_data';
            return (
              <li key={p.segment_id} className="lp-panel__row">
                <span className="lp-panel__road">
                  {segIndex[p.segment_id]?.name ?? p.segment_id} <span className="lp-panel__id">{p.segment_id}</span>
                </span>
                <span className="lp-panel__delta num">{fmtSigned(p.expected_change_kph)} km/h</span>
                <span className="lp-panel__levels">
                  <LevelSwatch level={now} />
                  <span className="lp-panel__from">{LEVEL_LABEL[now]}</span>
                  <span aria-hidden="true">→</span>
                  <span className="visually-hidden">to</span>
                  <LevelSwatch level={p.predicted_level} />
                  {LEVEL_LABEL[p.predicted_level]}
                </span>
                <span className="meter lp-panel__meter" role="img" aria-label={`Risk score ${Math.round(p.risk * 100)} of 100`}>
                  <span className="meter__fill" style={{ transform: `scaleX(${p.risk})`, background: `var(--level-${p.predicted_level})` }} />
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="lp-panel__empty">No segment is forecast to get worse in the next 10 minutes.</p>
      )}
      <div className="lp-panel__foot">
        <span className="num">
          {predictions ? `${predictions.model.kind === 'rule_baseline' ? 'rule-based baseline' : `model ${predictions.model.version}`} · made ${fmtTime(predictions.made_at)} IST` : 'no forecast yet'}
        </span>
        <Link to="/forecast" viewTransition className="lp-panel__link">
          Forecast <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </div>
    </aside>
  );
}
