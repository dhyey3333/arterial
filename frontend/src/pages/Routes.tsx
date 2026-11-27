import { useMemo, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { ArrowUpDown, RotateCcw, Unplug } from 'lucide-react';
import { LevelBar } from '../components/charts/charts';
import { TrafficMap, type MapRoute } from '../components/map/TrafficMap';
import { PlaceField } from '../components/ui/PlaceField';
import { Empty, Notice, useMediaQuery } from '../components/ui/primitives';
import { useSource } from '../data/LiveProvider';
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

function Option({ title, option, tone, note }: { title: string; option: RouteOption; tone: 'primary' | 'compare' | 'alt'; note?: string }) {
  return (
    <article className={`rt-opt rt-opt--${tone}`}>
      <header className="rt-opt__head">
        <span className={`rt-opt__key rt-opt__key--${tone}`} aria-hidden="true" />
        <h3 className="rt-opt__title">{title}</h3>
        <span className="rt-opt__eta num">{fmtDuration(option.eta_s)}</span>
      </header>
      <dl className="rt-opt__facts">
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
      {note && <p className="rt-opt__note">{note}</p>}
    </article>
  );
}

export default function Routes() {
  const network = useLive((s) => s.network);
  const source = useSource();
  // no default ends: the ids belong to whichever region the API serves
  const [origin, setOrigin] = useState<string>('');
  const [destination, setDestination] = useState<string>('');
  const route = useRoute();
  const narrow = useMediaQuery('(max-width: 900px)');
  const names = useMemo(() => new Map((network?.nodes ?? []).map((n) => [n.id, n.name])), [network]);
  const res = route.data;
  const reduce = useReducedMotion();
  // bumping this plays the race again
  const [run, setRun] = useState(0);

  const mapRoute: MapRoute | null = useMemo(() => {
    if (!res) return null;
    const same = res.free_flow_fastest.segment_ids.join() === res.recommended.segment_ids.join();
    const compare = same ? res.alternative : res.free_flow_fastest;
    return {
      primary: res.recommended.geometry,
      compare: compare?.geometry ?? null,
      race: { primaryEtaS: res.recommended.eta_s, compareEtaS: compare?.eta_s ?? null, run },
    };
  }, [res, run]);

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
  const noRoute = err instanceof ApiError && err.status === 409;

  return (
    <div className="rt">
      <div className="rt__map">
        <TrafficMap
          ariaLabel="Route map with junctions you can pick"
          showVehicles={false}
          route={mapRoute}
          nodes={{ origin: origin || null, destination: destination || null, onPick: pick }}
          showLegend
          padding={narrow ? { top: 32, right: 32, bottom: 72, left: 32 } : { top: 48, right: 48, bottom: 72, left: 436 }}
        />
        {res && (
          <div className="rt__key float">
            <span>
              <span className="rt__line rt__line--primary" aria-hidden="true" /> Recommended
            </span>
            {mapRoute?.compare && (
              <span>
                <span className="rt__line rt__line--compare" aria-hidden="true" /> {same ? 'Alternative' : 'Usual route'}
              </span>
            )}
          </div>
        )}
      </div>

      <aside className="rt__panel float enter" style={{ '--i': 60 } as React.CSSProperties}>
        <header className="rt__head">
          <h1 className="phead__title">Routes</h1>
          <p className="rt__lede">The fastest path under current conditions, against the usual route</p>
        </header>

        <form className="rt__form" onSubmit={submit}>
          <div className="rt__stops">
            <div className="rt__stop">
              <span className="rt__pin rt__pin--a" aria-hidden="true" />
              <PlaceField id="origin" label="From" value={origin} valueName={names.get(origin) ?? ''} onChange={(id) => setOrigin(id)} exclude={destination} placeholder="A junction or a road" />
            </div>
            <div className="rt__stop">
              <span className="rt__pin rt__pin--b" aria-hidden="true" />
              <PlaceField id="destination" label="To" value={destination} valueName={names.get(destination) ?? ''} onChange={(id) => setDestination(id)} exclude={origin} placeholder="A junction or a road" />
            </div>
            <button
              type="button"
              className="btn btn--icon rt__swap"
              aria-label="Swap start and end"
              onClick={() => {
                setOrigin(destination);
                setDestination(origin);
              }}
            >
              <ArrowUpDown size={15} aria-hidden="true" />
            </button>
          </div>
          <button type="submit" className="btn btn--accent btn--block" disabled={!origin || !destination || route.isPending}>
            {route.isPending ? 'Finding the route…' : 'Find the fastest route'}
          </button>
          <p className="rt__hint">Type a junction or a road, or click junctions on the map: the first sets the start, the second the end.</p>
        </form>

        <div className="rt__result">
          {err ? (
            <Notice tone={noRoute ? 'warn' : 'bad'} title={noRoute ? 'No route' : 'Route request failed'} icon={Unplug}>
              {err.message}
              {noRoute && source.kind === 'fixtures' && (
                <button
                  type="button"
                  className="btn rt__sample"
                  onClick={() => {
                    // the one pair the design fixtures hold
                    setOrigin('N04');
                    setDestination('N02');
                    route.mutate({ origin: 'N04', destination: 'N02' });
                  }}
                >
                  Show the sample route
                </button>
              )}
            </Notice>
          ) : res ? (
            <>
              <div className="rt__verdict">
                <p className="rt__verdict-title">{res.time_saved_s >= 60 ? `Saves ${fmtDuration(res.time_saved_s)} against the usual route` : 'The usual route is still the fastest'}</p>
                <p className="rt__verdict-meta num">
                  Conditions at {fmtTime(res.as_of)} IST · {res.algorithm === 'a_star' ? 'A*' : 'Dijkstra'} over current segment speeds
                </p>
                {!reduce && (
                  <button type="button" className="rt__replay" onClick={() => setRun((n) => n + 1)}>
                    <RotateCcw size={13} aria-hidden="true" />
                    Replay the trip
                  </button>
                )}
              </div>
              <Option title="Recommended now" option={res.recommended} tone="primary" />
              {!same && <Option title="Usual fastest route" option={res.free_flow_fastest} tone="compare" note="Fastest when roads run at free flow, timed at current speeds." />}
              {res.alternative && same && <Option title="Alternative" option={res.alternative} tone="alt" />}
              <ul className="drivers">
                {res.explanation.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </>
          ) : (
            <Empty title="No route yet">Search two places, or click two junctions on the map, then ask for the fastest route.</Empty>
          )}
        </div>
      </aside>
    </div>
  );
}
