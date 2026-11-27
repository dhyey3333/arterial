import maplibregl, { type LngLatBoundsLike, type Map as MLMap, type PaddingOptions } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { RoadNetwork, SegmentLevel } from '../lib/contract';
import { loadTileStyle, tilesAt } from '../components/map/basemap';
import { LEVEL_RGB, type Plane } from './geometry';
import { NIGHT_LIGHT, nightCityLayers } from './nightCity';
import { startTraffic, type RoadNow, type TrafficControl } from './traffic';

/** The colour of a corridor before any data: a plain light grey, so no level is claimed. */
const NEUTRAL: [number, number, number] = [214, 214, 214];
// the opening view: peninsular India, where the tiles already carry its highways and its coast draws
// itself; the whole country at once is too far up for the roads to show
const INDIA: LngLatBoundsLike = [
  [72.6, 8.0],
  [84.6, 21.0],
];

interface Props {
  plane: Plane;
  network: RoadNetwork;
  /** The hero's colours: each corridor's level now, or null for the neutral glow. */
  levels?: Record<string, SegmentLevel> | null;
  /** What the simulated traffic follows, read every step. */
  readTraffic: () => Record<string, RoadNow> | null;
  paused: boolean;
  reduce: boolean;
  /** A still of the same view, shown while the map loads and if it cannot draw at all. */
  poster: string;
  /** Called with a short readout of the camera ("11.4 km across · 12.92° N 77.64° E"), as it moves. */
  onView?: (text: string) => void;
}

const mix = (rgb: [number, number, number], k: number) => `rgb(${rgb.map((c) => Math.round(c + (255 - c) * k)).join(',')})`;

function km(a: maplibregl.LngLat, b: maplibregl.LngLat) {
  const R = 6371;
  const p = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * p) / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(((b.lng - a.lng) * p) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * A real city at night under Arterial's corridors: OpenStreetMap through OpenFreeMap's tiles, the roads as
 * light, buildings standing in 3D, and the monitored corridors glowing in their congestion colour with the
 * landing's simulated traffic running on them as light trails. It flies in from all of India to the corridors
 * and then sways slowly. Under reduced motion it is a still of the final view. One button (the page's) pauses all of it.
 */
export default function CityScene({ plane, network, levels = null, readTraffic, paused, reduce, poster, onView }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const traffic = useRef<TrafficControl | null>(null);
  const [drawn, setDrawn] = useState(false);
  const [arrived, setArrived] = useState(false);
  const live = useRef({ paused, readTraffic, onView, levels });
  live.current = { paused, readTraffic, onView, levels };
  const sway = useRef<{ go: () => void; halt: () => void } | null>(null);
  // the camera sways only while the hero is on screen and not paused
  const onScreen = useRef(true);

  useEffect(() => {
    const el = mapEl.current;
    if (!el) return;
    let map: MLMap | null = null;
    let cancelled = false;
    const ac = new AbortController();
    const BEARING = -24;
    const PITCH = 62;

    // on a narrow screen the corridors go in the space the hero keeps free under its words
    const below = () => {
      const fine = el.closest('.lp-hero')?.querySelector('.lp-fine');
      const h = el.clientHeight;
      if (!fine) return h * 0.6;
      return Math.min(h * 0.8, Math.max(h * 0.4, fine.getBoundingClientRect().bottom - el.getBoundingClientRect().top + 36));
    };
    // the corridors sit right of the hero's words on a wide screen, and in the lower half on a narrow one
    const padding = (): PaddingOptions => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      // wide: right of the words and above the forecast panel; narrow: the lower half, under the words
      return w >= 1024 ? { top: h * 0.16, bottom: h * 0.38, left: w * 0.54, right: w * 0.05 } : { top: below(), bottom: h * 0.04, left: w * 0.04, right: w * 0.04 };
    };
    const finalCamera = (m: MLMap) => {
      const cam = m.cameraForBounds(plane.bbox as LngLatBoundsLike, { padding: padding(), bearing: BEARING });
      // tipping the camera brings the near half of the network closer: zoom in a little to fill the frame
      return { center: cam?.center ?? m.getCenter(), zoom: (cam?.zoom ?? 12) + (el.clientWidth >= 1280 ? 0.4 : 0.15), bearing: BEARING, pitch: PITCH };
    };
    let base: ReturnType<typeof finalCamera> | null = null;

    const reveal = (m: MLMap, instant: boolean) => {
      const order = [...plane.segments].sort((a, b) => a.fromCentre - b.fromCentre);
      if (instant) {
        for (const s of order) m.setFeatureState({ source: 'corridors', id: s.id }, { on: 1 });
        return;
      }
      const t0 = performance.now();
      const run = (now: number) => {
        if (!mapRef.current) return;
        let done = true;
        order.forEach((s, i) => {
          // quick enough that the whole network is lit within a second of arriving
          const k = Math.min(1, Math.max(0, (now - t0 - i * 20) / 450));
          if (k < 1) done = false;
          m.setFeatureState({ source: 'corridors', id: s.id }, { on: 1 - (1 - k) ** 3 });
        });
        if (!done) requestAnimationFrame(run);
      };
      requestAnimationFrame(run);
    };

    const startCars = (m: MLMap) => {
      const cv = canvas.current;
      if (!cv) return;
      const roads = plane.segments.map((s) => ({ id: s.id, name: s.name, lengthM: s.lengthM, freeFlowKph: s.freeFlowKph, fromNode: s.fromNode, toNode: s.toNode, pts: s.pts }));
      traffic.current = startTraffic(
        [
          {
            canvas: cv,
            laneOffset: 0.55,
            exposure: 14,
            lightScale: 0.95,
            project: (x, y) => {
              const p = m.project(plane.toLngLat(x, y));
              return Number.isFinite(p.x) && Number.isFinite(p.y) ? [p.x, p.y] : null;
            },
          },
        ],
        roads,
        () => live.current.readTraffic(),
        { planeWidth: plane.w, reduce, timeScale: 14 },
      );
      traffic.current.setPaused(live.current.paused);
    };

    const readout = (m: MLMap) => {
      const say = live.current.onView;
      // a map given up for the poster no longer speaks for the picture
      if (!say || mapRef.current !== m) return;
      const w = m.getContainer().clientWidth;
      const h = m.getContainer().clientHeight;
      const across = km(m.unproject([0, h * 0.62]), m.unproject([w, h * 0.62]));
      const c = m.getCenter();
      const dist = across >= 100 ? `${Math.round(across / 10) * 10} km` : `${across.toFixed(1)} km`;
      say(`${dist} across · ${c.lat.toFixed(2)}° N ${c.lng.toFixed(2)}° E`);
    };

    (async () => {
      let style;
      let indexes: string[] = [];
      try {
        const res = await loadTileStyle(nightCityLayers, ac.signal);
        if (!res.ok) return; // the poster stays
        style = res.style;
        indexes = res.indexes;
      } catch {
        return;
      }
      if (cancelled) return;
      try {
        map = new maplibregl.Map({
          container: el,
          style,
          interactive: false,
          attributionControl: false,
          fadeDuration: 0,
          pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
          center: [78.9, 22],
          zoom: 4,
          maxPitch: 70,
          // a machine that would draw this on the CPU (no GPU, or a blocked one) keeps the still poster:
          // two 3D maps in software would stall the whole page
          canvasContextAttributes: { failIfMajorPerformanceCaveat: true, antialias: true },
        });
      } catch {
        return; // no WebGL, or only a software one: the poster stays
      }
      mapRef.current = map;
      const m = map;
      m.on('webglcontextlost', () => setDrawn(false));
      let frame = 0;
      m.on('move', () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          readout(m);
          // a paused or still picture follows the camera too
          if (live.current.paused || reduce) traffic.current?.redraw();
        });
      });
      let landed = false;
      m.on('resize', () => {
        if (!base || !landed) return;
        base = finalCamera(m);
        sway.current?.halt();
        m.jumpTo(base);
        sway.current?.go();
      });
      // The opening: all of India, then down to the corridors. On a slow connection the country's large
      // tiles would hold the city back (and the map's load event waits for its first full picture), so if
      // the country has not drawn 3 s after the map starts, the camera goes straight to the corridors and
      // the city shows as soon as its own, smaller tiles do.
      let phase: 'india' | 'flying' | 'city' = 'india';
      let cityNow: (() => void) | null = null;
      if (!reduce)
        window.setTimeout(() => {
          if (phase !== 'india' || cancelled || !map) return;
          phase = 'city';
          if (cityNow) cityNow();
          else m.jumpTo(finalCamera(m));
        }, 3000);
      // The city under the corridors is OpenFreeMap's tiles. If they do not come (the service moved them,
      // or the network dropped them), the corridors would glow on an empty ground: the still poster of the
      // same view comes back instead, and the map stops.
      let failedTiles = 0;
      m.on('error', (e) => {
        if ((e as { sourceId?: string }).sourceId === 'openmaptiles') failedTiles++;
      });
      // judged by what is drawn on screen: a far-out tile can still hold data that none of the city's
      // layers draws this close, which leaves the screen just as empty
      const bare = () => {
        try {
          const ids = (m.getStyle().layers ?? []).filter((l) => 'source' in l && l.source === 'openmaptiles').map((l) => l.id);
          return ids.length > 0 && m.queryRenderedFeatures({ layers: ids }).length === 0;
        } catch {
          return false;
        }
      };
      // OpenFreeMap keeps a main and a backup tile set: when one fails, ask for the other, once
      let retried = false;
      const otherTiles = async () => {
        const src = m.getSource('openmaptiles') as maplibregl.VectorTileSource | undefined;
        if (!src) return false;
        for (const url of indexes) {
          const tiles = await tilesAt(url, ac.signal);
          if (cancelled || !map) return false;
          if (tiles && tiles[0] !== src.tiles?.[0]) {
            failedTiles = 0;
            src.setTiles(tiles);
            return true;
          }
        }
        return false;
      };
      const giveUp = () => {
        if (cancelled || !map) return;
        setDrawn(false);
        // the readout described the map's camera; the poster is the opening view
        live.current.onView?.('India');
        sway.current?.halt();
        sway.current = null;
        traffic.current?.stop();
        traffic.current = null;
        mapRef.current = null;
        const gone = map;
        map = null;
        // let the poster fade back in over the map before the map goes
        window.setTimeout(() => gone.remove(), 1200);
      };
      // A city that never comes must not leave the corridors on an empty ground. Slow tiles are waited
      // for, however long they take (the still poster shows meanwhile, and the map fades in and plays the
      // moment they arrive), so a slow connection sees the animation late rather than never. Only once
      // every tile in view has answered (a missing tile answers as an empty one, not an error) and nothing
      // is drawn does the other tile set get one try, and after that the poster stays. Checked on a clock
      // as well as on idle, since the camera keeps moving.
      const ensureCity = (then: () => void, first = 4500) => {
        let done = false;
        const check = async () => {
          if (done || cancelled || !map) return;
          if (!bare()) {
            done = true;
            then();
            return;
          }
          const answered = failedTiles > 0 || m.areTilesLoaded();
          if (!answered) {
            window.setTimeout(check, 1000);
            return;
          }
          if (!retried) {
            retried = true;
            if (await otherTiles()) {
              window.setTimeout(check, 1500);
              return;
            }
          }
          done = true;
          giveUp();
        };
        m.once('idle', check);
        window.setTimeout(check, first);
      };
      const whenDrawn = (go: () => void, first?: number) => ensureCity(go, first);
      // after landing, the city's closer tiles must come too (most arrive during the flight)
      const watchCity = () => ensureCity(() => {}, 2500);

      m.on('load', () => {
        m.setLight(NIGHT_LIGHT as unknown as maplibregl.LightSpecification);
        m.addSource('corridors', {
          type: 'geojson',
          promoteId: 'id',
          data: {
            type: 'FeatureCollection',
            features: network.segments.map((s) => ({ type: 'Feature', properties: { id: s.id }, geometry: { type: 'LineString', coordinates: s.geometry } })),
          },
        });
        const on = ['coalesce', ['feature-state', 'on'], 0];
        const colour = ['coalesce', ['feature-state', 'colour'], mix(NEUTRAL, 0)];
        const layout = { 'line-cap': 'round', 'line-join': 'round' } as const;
        const zw = (a: number, b: number) => ['interpolate', ['exponential', 1.5], ['zoom'], 10, a, 15, b];
        m.addLayer({ id: 'corridor-halo', type: 'line', source: 'corridors', layout, paint: { 'line-color': colour as never, 'line-width': zw(14, 56) as never, 'line-blur': zw(10, 36) as never, 'line-opacity': ['*', 0.42, on] as never } });
        m.addLayer({ id: 'corridor-glow', type: 'line', source: 'corridors', layout, paint: { 'line-color': colour as never, 'line-width': zw(5, 16) as never, 'line-blur': zw(2.5, 7) as never, 'line-opacity': ['*', 0.85, on] as never } });
        m.addLayer({ id: 'corridor-core', type: 'line', source: 'corridors', layout, paint: { 'line-color': ['coalesce', ['feature-state', 'core'], mix(NEUTRAL, 0.55)] as never, 'line-width': zw(1.7, 4.6) as never, 'line-opacity': ['*', 1, on] as never } });

        base = finalCamera(m);
        const arrive = () => {
          landed = true;
          setArrived(true);
          reveal(m, reduce);
          startCars(m);
          watchCity();
          if (!reduce) {
            let dir = 1;
            let swaying = false;
            const swing = () => {
              if (!mapRef.current || live.current.paused || !onScreen.current || !base || swaying) return;
              swaying = true;
              m.easeTo({ bearing: base.bearing + 8 * dir, duration: 18000, easing: (t) => 0.5 - Math.cos(Math.PI * t) / 2 }, { sway: true });
              dir = -dir;
            };
            sway.current = {
              go: swing,
              halt: () => {
                swaying = false;
                m.stop();
              },
            };
            m.on('moveend', (e) => {
              if (!(e as { sway?: boolean }).sway) return;
              swaying = false;
              swing();
            });
            swing();
          }
        };

        if (reduce) {
          m.jumpTo(base);
          whenDrawn(() => {
            setDrawn(true);
            arrive();
          }, 1200);
          return;
        }
        // straight to the corridors: the way in on a slow connection
        cityNow = () => {
          if (cancelled || !base) return;
          m.jumpTo(base);
          // checked from 1.2 s: the country's abandoned tiles can keep the map from ever going idle
          whenDrawn(() => {
            setDrawn(true);
            arrive();
          }, 1200);
        };
        if (phase === 'city') {
          cityNow();
          return;
        }
        // all of India first, its highways lit, then down to the corridors, quickly: someone opening the
        // page should see the city within a few seconds, so the flight leaves as soon as the country has drawn
        const india = m.cameraForBounds(INDIA, { padding: padding() });
        m.jumpTo({ center: india?.center ?? [78.9, 22], zoom: india?.zoom ?? 4, pitch: 0, bearing: 0 });
        whenDrawn(() => {
          if (phase !== 'india' || cancelled || !base) return;
          phase = 'flying';
          setDrawn(true);
          window.setTimeout(() => {
            if (cancelled || !base) return;
            m.flyTo({ ...base, duration: 3000, curve: 1.25, essential: true, easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2) }, { flight: true });
            m.once('moveend', () => !cancelled && arrive());
          }, 250);
        }, 1200);
      });
    })();

    return () => {
      cancelled = true;
      ac.abort();
      traffic.current?.stop();
      traffic.current = null;
      sway.current = null;
      mapRef.current = null;
      map?.remove();
    };
    // the scene is built once per network; everything that changes later goes through refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network, plane, reduce]);

  // the hero's colours follow the stream
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !arrived || !m.getSource('corridors')) return;
    for (const s of plane.segments) {
      const rgb = levels ? LEVEL_RGB[levels[s.id] ?? 'no_data'] : NEUTRAL;
      m.setFeatureState({ source: 'corridors', id: s.id }, { colour: mix(rgb, 0), core: mix(rgb, 0.55) });
    }
  }, [levels, arrived, plane]);

  // pause: the traffic stops, and so does the camera
  useEffect(() => {
    traffic.current?.setPaused(paused);
    const m = mapRef.current;
    if (!m) return;
    if (paused) sway.current?.halt();
    else sway.current?.go();
  }, [paused]);

  // the camera rests while the hero is off screen
  useEffect(() => {
    const el = host.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => {
      onScreen.current = e.isIntersecting;
      const m = mapRef.current;
      if (!m) return;
      if (!e.isIntersecting) sway.current?.halt();
      else sway.current?.go();
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className={`lp-city lp-net ${drawn ? 'is-drawn' : ''} ${arrived ? 'is-arrived' : ''}`} ref={host} aria-hidden="true">
      <img className="lp-city__poster" src={poster} alt="" decoding="async" />
      <div className="lp-city__map" ref={mapEl} />
      <canvas className="lp-city__traffic" ref={canvas} />
    </div>
  );
}
