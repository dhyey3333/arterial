import { useReducedMotion } from 'motion/react';
import { Suspense, lazy, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { RoadNetwork, SegmentLevel } from '../lib/contract';
import type { Plane } from './geometry';
import type { RoadNow } from './traffic';

// MapLibre loads after the first paint: the words come first, the city a moment later
const CityScene = lazy(() => import('./CityScene'));

export const HERO_POSTER = '/landing/city-hero.jpg';

function Poster() {
  return <img className="lp-city__poster lp-city__poster--alone" src={HERO_POSTER} alt="" decoding="async" onError={(e) => (e.currentTarget.style.display = 'none')} />;
}

/**
 * The hero's picture: India at night from OpenStreetMap, flying down to Arterial's corridors in Bengaluru,
 * with a readout of where the camera is and one button that pauses the camera and the traffic.
 */
export function HeroCity({ plane, network, live }: { plane: Plane; network: RoadNetwork; live: { levels: Record<string, SegmentLevel>; roads: Record<string, RoadNow> } | null }) {
  const reduce = !!useReducedMotion();
  const [paused, setPaused] = useState(false);
  const liveRef = useRef(live);
  liveRef.current = live;
  const hud = useRef<HTMLSpanElement>(null);

  return (
    <div className="lp-viz">
      <Suspense fallback={<Poster />}>
        <CityScene
          plane={plane}
          network={network}
          levels={live?.levels ?? null}
          readTraffic={() => liveRef.current?.roads ?? null}
          paused={paused}
          reduce={reduce}
          poster={HERO_POSTER}
          onView={(t) => {
            if (hud.current) hud.current.textContent = t;
          }}
        />
      </Suspense>
      <p className="lp-hud" aria-hidden="true">
        <span className="lp-hud__dot" />
        <span ref={hud} className="num">
          India
        </span>
      </p>
      {!reduce && (
        <button type="button" className="lp-pause" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play the city' : 'Pause the city'} aria-pressed={paused}>
          {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}
