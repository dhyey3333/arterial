import { useMemo, useState } from 'react';
import { ArrowLeftRight, Unplug } from 'lucide-react';
import { LevelBar } from '../components/charts/charts';
import { TrafficMap, type MapRoute } from '../components/map/TrafficMap';
import { Empty, Notice, Panel } from '../components/ui/primitives';
import { useRoute } from '../data/queries';
import { useLive } from '../data/store';
import { ApiError } from '../lib/api';
import type { RoadNode, RouteOption, SegmentLevel } from '../lib/contract';
import { fmtDistance, fmtDuration, fmtTime } from '../lib/format';

function kmByLevel(o: RouteOption): Record<SegmentLevel, number> {
  const out = {} as Record<SegmentLevel, number>;
  for (const [k, v] of Object.entries(o.exposure_m)) out[k as SegmentLevel] = v / 1000;
  return out;
}

function OptionCard({ title, option, tone, note }: { title: string; option: RouteOption; tone: 'primary' | 'compare' | 'alt'; note?: string }) {
  return (
    <article className={`routecard routecard--${tone}`}>
      <header className="routecard__head">
        <span className={`routecard__key routecard__key--${tone}`} aria-hidden="true" />
        <h3 className="routecard__title">{title}</h3>
      </header>
      <p className="routecard__eta">
        <span className="num">{fmtDuration(option.eta_s)}</span>
      </p>
      <dl className="glance glance--wide">
        <div>
          <dt>Distance</dt>
          <dd className="num">{fmtDistance(option.distance_m)}</dd>
        </div>
        <div>
          <dt>Delay vs free flow</dt>
          <dd className="num">{fmtDuration(option.delay_s)}</dd>
        </div>
        <div>
          <dt>Segments</dt>
          <dd className="num">{option.segment_ids.length}</dd>
        </div>
      </dl>
      <LevelBar km={kmByLevel(option)} title={`${title}: road length by congestion level`} />
      {note && <p className="muted small">{note}</p>}
    </article>
  );
}

export default function Routes() {
  const network = useLive((s) => s.network);
  const [origin, setOrigin] = useState<string>('N04');
  const [destination, setDestination] = useState<string>('N02');
  const route = useRoute();
  const nodes = useMemo(() => [...(network?.nodes ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [network]);
  const res = route.data;

  const mapRoute: MapRoute | null = useMemo(() => {
    if (!res) return null;
    const same = res.free_flow_fastest.segment_ids.join() === res.recommended.segment_ids.join();
    return { primary: res.recommended.geometry, compare: same ? res.alternative?.geometry ?? null : res.free_flow_fastest.geometry };
  }, [res]);

  const pick = (n: RoadNode) => {
    if (!origin || (origin && destination)) {
      setOrigin(n.id);
      setDestination('');
    } else if (n.id !== origin) {
      setDestination(n.id);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (origin && destination) route.mutate({ origin, destination });
  };

  const err = route.error as ApiError | Error | null;
  const same = res && res.free_flow_fastest.segment_ids.join() === res.recommended.segment_ids.join();

  return (
    <div className="routes">
      <div className="routes__side">
        <Panel title="Plan a trip" meta="A* over current segment speeds" enter={0}>
          <form className="routeform" onSubmit={submit}>
            <div className="field">
              <label className="field__label" htmlFor="origin">
                From
              </label>
              <select id="origin" className="select" value={origin} onChange={(e) => setOrigin(e.target.value)}>
                <option value="">Pick a junction</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--icon routeform__swap"
              aria-label="Swap start and end"
              onClick={() => {
                setOrigin(destination);
                setDestination(origin);
              }}
            >
              <ArrowLeftRight size={16} aria-hidden="true" />
            </button>
            <div className="field">
              <label className="field__label" htmlFor="destination">
                To
              </label>
              <select id="destination" className="select" value={destination} onChange={(e) => setDestination(e.target.value)}>
                <option value="">Pick a junction</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id} disabled={n.id === origin}>
                    {n.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn--primary routeform__go" disabled={!origin || !destination || route.isPending}>
              {route.isPending ? 'Finding the route…' : 'Find the fastest route'}
            </button>
            <p className="muted small">Or click junctions on the map: the first sets the start, the second the end.</p>
          </form>
        </Panel>

        {err ? (
          <Notice tone={err instanceof ApiError && err.status === 409 ? 'warn' : 'bad'} title={err instanceof ApiError && err.status === 409 ? 'No route' : 'Route request failed'} icon={Unplug}>
            {err.message}
          </Notice>
        ) : null}

        {res ? (
          <Panel
            title={res.time_saved_s >= 60 ? `Saves ${fmtDuration(res.time_saved_s)} against the usual route` : 'The usual route is still the fastest'}
            meta={`Conditions at ${fmtTime(res.as_of)} IST · ${res.algorithm === 'a_star' ? 'A*' : 'Dijkstra'}`}
            enter={40}
          >
            <div className="routecards">
              <OptionCard title="Recommended now" option={res.recommended} tone="primary" />
              {!same && <OptionCard title="Usual fastest route" option={res.free_flow_fastest} tone="compare" note="Fastest when roads run at free flow, timed at current speeds." />}
              {res.alternative && same && <OptionCard title="Alternative" option={res.alternative} tone="alt" />}
            </div>
            <ul className="drivers">
              {res.explanation.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </Panel>
        ) : !err ? (
          <Panel enter={40}>
            <Empty title="No route yet">Pick a start and an end, then ask for the fastest route.</Empty>
          </Panel>
        ) : null}
      </div>
      <div className="routes__map panel panel--map enter" style={{ '--i': 60 } as React.CSSProperties}>
        <TrafficMap
          ariaLabel="Route map with junctions you can pick"
          showVehicles={false}
          route={mapRoute}
          nodes={{ origin: origin || null, destination: destination || null, onPick: pick }}
          showLegend
          padding={{ top: 48, right: 48, bottom: 72, left: 48 }}
        />
        {res && (
          <div className="routes__key">
            <span>
              <span className="routes__line routes__line--primary" aria-hidden="true" /> Recommended
            </span>
            {mapRoute?.compare && (
              <span>
                <span className="routes__line routes__line--compare" aria-hidden="true" /> {same ? 'Alternative' : 'Usual route'}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
