import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cubicBezier, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Scan } from 'lucide-react';
import type { Incident, LngLat, RoadNetwork, RoadNode, SegmentLevel } from '../../lib/contract';
import { LEVEL_LABEL, LEVEL_RANK, fmtInt, fmtSpeed } from '../../lib/format';
import { useLive } from '../../data/store';
import { FIRST_LABEL, loadBasemap } from './basemap';
import { LevelSwatch } from '../ui/primitives';
import { LEVEL_OPACITY, LEVEL_RGB, LEVEL_WIDTH } from './levels';

const easeInOut = cubicBezier(0.77, 0, 0.175, 1);
const easeOut = cubicBezier(0.23, 1, 0.32, 1);
const COLOR_MS = 600;

/** A segment's look, eased as a whole when its level changes: colour, width, opacity, and the forecast's worse-than-now dashes. */
interface Look {
  rgb: [number, number, number];
  w: number;
  op: number;
  wo: number;
}

export interface MapRoute {
  primary: LngLat[];
  compare?: LngLat[] | null;
  /**
   * The two trips played side by side once the route has drawn: each light takes screen time in
   * proportion to its real ETA, so the faster route visibly arrives first. `run` changes to replay.
   */
  race?: { primaryEtaS: number; compareEtaS: number | null; run: number } | null;
}

/** A polyline measured once, so a point or a stretch at any share of its length is cheap to find. */
function measure(coords: LngLat[]) {
  const k = Math.cos(((coords[0]?.[1] ?? 0) * Math.PI) / 180);
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    const dx = (coords[i][0] - coords[i - 1][0]) * k;
    const dy = coords[i][1] - coords[i - 1][1];
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  const total = cum[cum.length - 1] || 1;
  const at = (f: number): LngLat => {
    const d = Math.min(1, Math.max(0, f)) * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const t = (d - cum[i - 1]) / seg;
    return [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t];
  };
  /** The stretch from share `a` to share `b`, with the vertices in between. */
  const stretch = (a: number, b: number): LngLat[] => {
    const out: LngLat[] = [at(a)];
    for (let i = 1; i < cum.length - 1; i++) if (cum[i] / total > a && cum[i] / total < b) out.push(coords[i]);
    out.push(at(b));
    return out;
  };
  return { at, stretch };
}

export interface TrafficMapProps {
  ariaLabel: string;
  mode?: 'now' | 'forecast';
  horizon?: number;
  selectedSegment?: string | null;
  /** A segment hovered in a list beside the map: it gets the same halo as a hover on the map. */
  hoverSegment?: string | null;
  onSelectSegment?: (id: string | null) => void;
  showVehicles?: boolean;
  incidents?: Incident[];
  route?: MapRoute | null;
  nodes?: { origin: string | null; destination: string | null; onPick: (node: RoadNode) => void } | null;
  focus?: string[] | null;
  padding?: { top: number; right: number; bottom: number; left: number };
  showLegend?: boolean;
  className?: string;
}

function bounds(net: RoadNetwork, ids?: string[] | null): [[number, number], [number, number]] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of net.segments) {
    if (ids && ids.length && !ids.includes(s.id)) continue;
    for (const [x, y] of s.geometry) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

function midpoint(geometry: LngLat[]): LngLat {
  return geometry[Math.floor(geometry.length / 2)];
}

const emptyFC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const NO_DATA_COLOR = `rgb(${LEVEL_RGB.no_data.join(',')})`;
const NO_DATA_W = LEVEL_WIDTH.no_data;
/** At country zoom only expressways and national highways are drawn; state highways join from zoom 7. */
const ROAD_FILTER = ['any', ['match', ['get', 'c'], ['motorway', 'trunk'], true, false], ['>=', ['zoom'], 7]] as unknown as maplibregl.FilterSpecification;

/**
 * Padding that keeps the network clear of floating panels, scaled down on a
 * small screen so at least 30% of the width and 40% of the height stay for roads.
 */
function fitPadding(el: HTMLElement, p: { top: number; right: number; bottom: number; left: number }) {
  const w = el.clientWidth || 800;
  const h = el.clientHeight || 600;
  const sx = Math.min(1, (w * 0.7) / Math.max(1, p.left + p.right));
  const sy = Math.min(1, (h * 0.6) / Math.max(1, p.top + p.bottom));
  return { top: p.top * sy, bottom: p.bottom * sy, left: p.left * sx, right: p.right * sx };
}

function addLayers(map: MLMap, net: RoadNetwork) {
  map.addSource('segments', {
    type: 'geojson',
    promoteId: 'id',
    data: {
      type: 'FeatureCollection',
      features: net.segments.map((s) => ({
        type: 'Feature',
        properties: { id: s.id, name: s.name, c: s.road_class },
        geometry: { type: 'LineString', coordinates: s.geometry },
      })),
    },
  });
  const w = (base: number, top: number) =>
    // thin at country zoom (the national tier), full width from city zoom up
    ['interpolate', ['linear'], ['zoom'], 4, ['*', ['coalesce', ['feature-state', 'w'], NO_DATA_W], base * 0.22], 11, ['*', ['coalesce', ['feature-state', 'w'], NO_DATA_W], base], 16, ['*', ['coalesce', ['feature-state', 'w'], NO_DATA_W], top]] as unknown as number;
  // road and route lines sit under the basemap's names, the way a traffic map keeps street names readable
  const under = map.getLayer(FIRST_LABEL) ? FIRST_LABEL : undefined;

  map.addLayer({
    id: 'seg-halo',
    type: 'line',
    source: 'segments',
    filter: ROAD_FILTER,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#eeeff1',
      'line-width': w(7, 16),
      'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.32, ['boolean', ['feature-state', 'hover'], false], 0.18, 0],
    },
  }, under);
  map.addLayer({
    id: 'seg-casing',
    type: 'line',
    source: 'segments',
    filter: ROAD_FILTER,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#0b0b0b', 'line-width': w(4.2, 10), 'line-opacity': 0.9 },
  }, under);
  map.addLayer({
    id: 'seg-line',
    type: 'line',
    source: 'segments',
    filter: ROAD_FILTER,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['coalesce', ['feature-state', 'color'], NO_DATA_COLOR],
      'line-width': w(2.4, 6.5),
      'line-opacity': ['coalesce', ['feature-state', 'opacity'], LEVEL_OPACITY.no_data],
    },
  }, under);
  map.addLayer({
    id: 'seg-worse',
    type: 'line',
    source: 'segments',
    filter: ROAD_FILTER,
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': '#0b0b0b',
      'line-width': w(1.2, 2.4),
      'line-dasharray': [1.5, 2],
      // 'wo' eases 0..1 with the colour, so the dashes fade in rather than appear
      'line-opacity': ['*', 0.85, ['coalesce', ['feature-state', 'wo'], 0]],
    },
  }, under);

  map.addSource('route-b', { type: 'geojson', data: emptyFC });
  map.addSource('route-a', { type: 'geojson', data: emptyFC });
  map.addLayer({
    id: 'route-b-line',
    type: 'line',
    source: 'route-b',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#bfbfbf', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 4], 'line-dasharray': [1.2, 1.6], 'line-opacity': 0.75 },
  }, under);
  map.addLayer({
    id: 'route-a-casing',
    type: 'line',
    source: 'route-a',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#0b0b0b', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 7, 16, 14] },
  }, under);
  map.addLayer({
    id: 'route-a-line',
    type: 'line',
    source: 'route-a',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#f2f2f3', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3.5, 16, 8] },
  }, under);

  // the route race: a light and a short streak for each route, dark ringed in white on the off-white
  // recommended line, light on the usual one, so the moving trip reads against the line it runs on
  map.addSource('race', { type: 'geojson', data: emptyFC });
  map.addLayer({
    id: 'race-trail',
    type: 'line',
    source: 'race',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['match', ['get', 'who'], 'a', '#0a0a0b', '#dcdcdc'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 8],
      'line-opacity': ['*', ['get', 'fade'], 0.7],
    },
  }, under);
  map.addLayer({
    id: 'race-dot',
    type: 'circle',
    source: 'race',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 5.5, 16, 9],
      'circle-color': ['match', ['get', 'who'], 'a', '#0a0a0b', '#e7e7e7'],
      'circle-stroke-color': ['match', ['get', 'who'], 'a', '#ffffff', '#0b0b0b'],
      'circle-stroke-width': 3,
      'circle-opacity': ['get', 'fade'],
      'circle-stroke-opacity': ['get', 'fade'],
    },
  }, under);

  map.addSource('vehicles', { type: 'geojson', data: emptyFC });
  map.addLayer({
    id: 'vehicles',
    type: 'circle',
    source: 'vehicles',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, 2.6, 17, 4.5],
      'circle-color': '#e5e5e5',
      // 'o' fades new vehicles in and departed ones out
      'circle-opacity': ['*', 0.92, ['coalesce', ['get', 'o'], 1]],
      'circle-stroke-opacity': ['coalesce', ['get', 'o'], 1],
      'circle-stroke-color': '#0b0b0b',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 16, 1.2],
    },
  });

  map.addSource('nodes', {
    type: 'geojson',
    promoteId: 'id',
    data: {
      type: 'FeatureCollection',
      features: net.nodes.map((n) => ({ type: 'Feature', properties: { id: n.id, name: n.name }, geometry: { type: 'Point', coordinates: [n.lng, n.lat] } })),
    },
  });
  map.addLayer({
    id: 'nodes',
    type: 'circle',
    source: 'nodes',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['case', ['any', ['boolean', ['feature-state', 'origin'], false], ['boolean', ['feature-state', 'destination'], false]], 8, ['boolean', ['feature-state', 'hover'], false], 7, 5],
      'circle-color': ['case', ['boolean', ['feature-state', 'origin'], false], '#f2f2f3', ['boolean', ['feature-state', 'destination'], false], '#eeeff1', '#181818'],
      'circle-stroke-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#eeeff1', '#adadad'],
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'seg-hit',
    type: 'line',
    source: 'segments',
    filter: ROAD_FILTER,
    paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 16 },
  });
}

export function TrafficMap({
  ariaLabel,
  mode = 'now',
  horizon = 10,
  selectedSegment = null,
  hoverSegment = null,
  onSelectSegment,
  showVehicles = true,
  incidents = [],
  route = null,
  nodes = null,
  focus = null,
  padding = { top: 48, right: 48, bottom: 48, left: 48 },
  showLegend = false,
  className = '',
}: TrafficMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [basemapOk, setBasemapOk] = useState(true);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [nodeHover, setNodeHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const reduce = useReducedMotion();

  const network = useLive((s) => s.network);
  const states = useLive((s) => s.states);
  const predictions = useLive((s) => s.predictions);
  const segIndex = useLive((s) => s.segIndex);

  const cb = useRef({ onSelectSegment, nodes });
  cb.current = { onSelectSegment, nodes };
  const paddingRef = useRef(padding);
  paddingRef.current = padding;

  // ---- create the map once per network ----
  useEffect(() => {
    if (!network || !containerRef.current) return;
    const container = containerRef.current;
    const ctrl = new AbortController();
    let map: MLMap | null = null;
    let cancelled = false;
    void loadBasemap(ctrl.signal)
      .then(({ style, ok }) => {
        if (cancelled) return;
        setBasemapOk(ok);
        map = new maplibregl.Map({
          container,
          style,
          bounds: bounds(network),
          fitBoundsOptions: { padding: fitPadding(container, paddingRef.current) },
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          // a city opens at street level; the national tier has to zoom out to the whole country
          minZoom: network.region.kind === 'national' ? 3.5 : 10,
          maxZoom: 18,
          fadeDuration: 0,
        });
        map.touchZoomRotate.disableRotation();
        map.keyboard.disableRotation();
        map.addControl(
          new maplibregl.AttributionControl({ compact: true, customAttribution: ok ? undefined : 'Road shapes © OpenStreetMap contributors' }),
          'bottom-right',
        );
        // Start the credit folded to its (i) button, so it never sits under the legend; it opens on click.
        map.once('load', () => container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
        const m = map;
        // Draw our layers as soon as the style is parsed, not after every basemap tile has arrived.
        let setUp = false;
        const setup = () => {
          if (cancelled || setUp) return;
          setUp = true;
          addLayers(m, network);
          let hovered: string | null = null;
          let hoveredNode: string | null = null;
          m.on('mousemove', 'seg-hit', (e) => {
            const id = e.features?.[0]?.id as string | undefined;
            if (!id) return;
            if (hovered && hovered !== id) m.setFeatureState({ source: 'segments', id: hovered }, { hover: false });
            hovered = id;
            m.setFeatureState({ source: 'segments', id }, { hover: true });
            m.getCanvas().style.cursor = 'pointer';
            setHover({ id, x: e.point.x, y: e.point.y });
          });
          m.on('mouseleave', 'seg-hit', () => {
            if (hovered) m.setFeatureState({ source: 'segments', id: hovered }, { hover: false });
            hovered = null;
            m.getCanvas().style.cursor = '';
            setHover(null);
          });
          m.on('mousemove', 'nodes', (e) => {
            const id = e.features?.[0]?.id as string | undefined;
            if (!id) return;
            if (hoveredNode && hoveredNode !== id) m.setFeatureState({ source: 'nodes', id: hoveredNode }, { hover: false });
            hoveredNode = id;
            m.setFeatureState({ source: 'nodes', id }, { hover: true });
            m.getCanvas().style.cursor = 'pointer';
            setNodeHover({ id, x: e.point.x, y: e.point.y });
          });
          m.on('mouseleave', 'nodes', () => {
            if (hoveredNode) m.setFeatureState({ source: 'nodes', id: hoveredNode }, { hover: false });
            hoveredNode = null;
            m.getCanvas().style.cursor = '';
            setNodeHover(null);
          });
          m.on('click', (e) => {
            const { nodes: nodeCtl, onSelectSegment: select } = cb.current;
            if (nodeCtl && m.getLayoutProperty('nodes', 'visibility') === 'visible') {
              const n = m.queryRenderedFeatures(e.point, { layers: ['nodes'] })[0];
              if (n) {
                const node = network.nodes.find((x) => x.id === n.id);
                if (node) nodeCtl.onPick(node);
                return;
              }
            }
            const f = m.queryRenderedFeatures(e.point, { layers: ['seg-hit'] })[0];
            select?.((f?.id as string | undefined) ?? null);
          });
          mapRef.current = m;
          setReady(true);
        };
        if (m.isStyleLoaded()) setup();
        else m.once('style.load', setup);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      ctrl.abort();
      setReady(false);
      mapRef.current = null;
      map?.remove();
    };
  }, [network]);

  // ---- segment colours: now or forecast, animated between windows ----
  /** What each segment looks like right now, so a new target eases from the colour on screen. */
  const current = useRef(new Map<string, Look>());
  const targets = useMemo(() => {
    const out = new Map<string, { level: SegmentLevel; worse: boolean }>();
    if (!network) return out;
    const byHorizon = new Map<string, SegmentLevel>();
    if (mode === 'forecast' && predictions) {
      for (const p of predictions.predictions) if (p.horizon_min === horizon) byHorizon.set(p.segment_id, p.predicted_level);
    }
    // Only segments that have data, a forecast, or a colour on screen: a country-sized network is
    // mostly roads with no report, and those keep the layer's default no-data look.
    const ids = new Set<string>([...Object.keys(states), ...byHorizon.keys(), ...current.current.keys()]);
    for (const id of ids) {
      if (!segIndex[id]) continue;
      const now = states[id]?.level ?? 'no_data';
      const level = mode === 'forecast' ? (byHorizon.get(id) ?? 'no_data') : now;
      out.set(id, { level, worse: mode === 'forecast' && LEVEL_RANK[level] > LEVEL_RANK[now] });
    }
    return out;
  }, [network, segIndex, states, predictions, mode, horizon]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const anims: { id: string; from: Look; to: Look }[] = [];
    const paint = (id: string, l: Look) =>
      map.setFeatureState({ source: 'segments', id }, { color: `rgb(${l.rgb.join(',')})`, w: l.w, opacity: l.op, wo: l.wo });
    for (const [id, t] of targets) {
      const to: Look = { rgb: LEVEL_RGB[t.level], w: LEVEL_WIDTH[t.level], op: LEVEL_OPACITY[t.level], wo: t.worse ? 1 : 0 };
      const from = current.current.get(id);
      if (!from && t.level === 'no_data' && !t.worse) continue; // the layer default already looks like this
      if (!from || reduce) {
        current.current.set(id, to);
        paint(id, to);
      } else if (from.rgb.join() !== to.rgb.join() || from.w !== to.w || from.op !== to.op || from.wo !== to.wo) {
        anims.push({ id, from, to });
      }
    }
    if (!anims.length) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = easeInOut(Math.min(1, (now - start) / COLOR_MS));
      for (const a of anims) {
        const l: Look = {
          rgb: a.from.rgb.map((c, i) => Math.round(c + (a.to.rgb[i] - c) * k)) as [number, number, number],
          w: a.from.w + (a.to.w - a.from.w) * k,
          op: a.from.op + (a.to.op - a.from.op) * k,
          wo: a.from.wo + (a.to.wo - a.from.wo) * k,
        };
        current.current.set(a.id, l);
        paint(a.id, l);
      }
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [targets, ready, reduce]);

  // ---- selection ----
  const selectedRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (selectedRef.current) map.setFeatureState({ source: 'segments', id: selectedRef.current }, { selected: false });
    if (selectedSegment) map.setFeatureState({ source: 'segments', id: selectedSegment }, { selected: true });
    selectedRef.current = selectedSegment;
  }, [selectedSegment, ready]);

  // ---- a segment hovered outside the map ----
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !hoverSegment) return;
    map.setFeatureState({ source: 'segments', id: hoverSegment }, { hover: true });
    return () => {
      if (mapRef.current) map.setFeatureState({ source: 'segments', id: hoverSegment }, { hover: false });
    };
  }, [hoverSegment, ready]);

  // ---- vehicles: slide between 1 s frames; new ones fade in, departed ones fade out where they were ----
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource('vehicles') as GeoJSONSource | undefined;
    if (!src) return;
    if (!showVehicles) {
      src.setData(emptyFC);
      return;
    }
    const FADE_IN = 360;
    const FADE_OUT = 260;
    const pos = new Map<string, { fx: number; fy: number; tx: number; ty: number; born: number }>();
    const gone = new Map<string, { x: number; y: number; died: number }>();
    let t0 = performance.now();
    let dur = 1000;
    let lastFrame = 0;
    let lastBorn = -Infinity;
    let raf = 0;
    let lastPush = 0;

    const progress = (now: number) => (reduce ? 1 : Math.min(1, (now - t0) / dur));
    const opacityIn = (now: number, born: number) => (reduce ? 1 : easeOut(Math.min(1, (now - born) / FADE_IN)));
    const busy = (now: number) => progress(now) < 1 || gone.size > 0 || (!reduce && now - lastBorn < FADE_IN);
    const push = (now: number) => {
      const k = progress(now);
      const features: GeoJSON.Feature[] = [];
      for (const [id, p] of pos) {
        features.push({
          type: 'Feature',
          id,
          properties: { o: opacityIn(now, p.born) },
          geometry: { type: 'Point', coordinates: [p.fx + (p.tx - p.fx) * k, p.fy + (p.ty - p.fy) * k] },
        });
      }
      for (const [id, g] of gone) {
        const o = reduce ? 0 : 1 - Math.min(1, (now - g.died) / FADE_OUT);
        if (o <= 0) {
          gone.delete(id);
          continue;
        }
        features.push({ type: 'Feature', id: `${id}~`, properties: { o }, geometry: { type: 'Point', coordinates: [g.x, g.y] } });
      }
      src.setData({ type: 'FeatureCollection', features });
    };
    const frame = (now: number) => {
      const done = !busy(now);
      // about 12 updates a second still reads as motion for dots this small, at a third of the GeoJSON work
      if (done || now - lastPush >= 80) {
        push(now);
        lastPush = now;
      }
      raf = done && !busy(now) ? 0 : requestAnimationFrame(frame);
    };
    const onVehicles = (list: { vehicle_id: string; lng: number; lat: number }[]) => {
      const now = performance.now();
      const k = progress(now);
      const seen = new Set<string>();
      for (const v of list) {
        seen.add(v.vehicle_id);
        const prev = pos.get(v.vehicle_id);
        if (!prev) {
          pos.set(v.vehicle_id, { fx: v.lng, fy: v.lat, tx: v.lng, ty: v.lat, born: now });
          lastBorn = now;
          continue;
        }
        const fx = prev.fx + (prev.tx - prev.fx) * k;
        const fy = prev.fy + (prev.ty - prev.fy) * k;
        // a jump of over ~300 m is a wrap or a reroute: fade out where it was and in where it is, never slide across the map
        if (Math.hypot(v.lng - fx, v.lat - fy) > 0.003) {
          gone.set(v.vehicle_id, { x: fx, y: fy, died: now });
          pos.set(v.vehicle_id, { fx: v.lng, fy: v.lat, tx: v.lng, ty: v.lat, born: now });
          lastBorn = now;
        } else {
          pos.set(v.vehicle_id, { fx, fy, tx: v.lng, ty: v.lat, born: prev.born });
        }
      }
      for (const [id, p] of pos) {
        if (seen.has(id)) continue;
        gone.set(id, { x: p.fx + (p.tx - p.fx) * k, y: p.fy + (p.ty - p.fy) * k, died: now });
        pos.delete(id);
      }
      dur = lastFrame ? Math.min(2500, Math.max(400, now - lastFrame)) : 1000;
      lastFrame = now;
      t0 = now;
      if (!raf) raf = requestAnimationFrame(frame);
    };
    onVehicles(useLive.getState().vehicles);
    const unsub = useLive.subscribe((s, p) => {
      if (s.vehicles !== p.vehicles) onVehicles(s.vehicles);
    });
    return () => {
      unsub();
      cancelAnimationFrame(raf);
    };
  }, [ready, showVehicles, reduce]);

  // ---- incidents: pulsing markers at the segment's midpoint; only new ones enter, gone ones fade out ----
  const markersRef = useRef(new Map<string, { marker: maplibregl.Marker; el: HTMLDivElement }>());
  const incidentKey = incidents.map((i) => `${i.incident_id}:${i.severity}`).join('|');
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const live = markersRef.current;
    const wanted = new Set<string>();
    for (const i of incidents) {
      const seg = segIndex[i.segment_id];
      if (!seg) continue;
      wanted.add(i.incident_id);
      const have = live.get(i.incident_id);
      if (have) {
        have.el.className = `incident-marker incident-marker--${i.severity}`;
        continue;
      }
      const el = document.createElement('div');
      el.className = `incident-marker incident-marker--${i.severity}`;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', `Active incident on ${seg.name}`);
      el.innerHTML = '<span class="incident-marker__ring"></span><span class="incident-marker__core"></span>';
      live.set(i.incident_id, { el, marker: new maplibregl.Marker({ element: el }).setLngLat(midpoint(seg.geometry)).addTo(map) });
    }
    for (const [id, m] of live) {
      if (wanted.has(id)) continue;
      live.delete(id);
      m.el.classList.add('is-leaving');
      setTimeout(() => m.marker.remove(), reduce ? 0 : 200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentKey, ready, segIndex]);
  useEffect(() => {
    const live = markersRef.current;
    return () => {
      for (const m of live.values()) m.marker.remove();
      live.clear();
    };
  }, [network]);

  // ---- routes: drawn in once, from origin to destination ----
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const a = map.getSource('route-a') as GeoJSONSource;
    const b = map.getSource('route-b') as GeoJSONSource;
    const line = (coords: LngLat[]): GeoJSON.FeatureCollection => ({
      type: 'FeatureCollection',
      features: coords.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] : [],
    });
    b.setData(line(route?.compare ?? []));
    if (!route) {
      a.setData(emptyFC);
      return;
    }
    const coords = route.primary;
    const raceSrc = map.getSource('race') as GeoJSONSource;
    raceSrc.setData(emptyFC);
    if (reduce || coords.length < 3) {
      a.setData(line(coords));
      return;
    }
    let raf = 0;

    // the race: both trips leave together; the slower one takes RACE_MS on screen, the faster one its share
    // of that, so the gap at the finish is the time saved. A short hold at the finish, then both fade.
    const RACE_MS = 3600;
    const race = () => {
      const r = route.race;
      if (!r || !r.primaryEtaS) return;
      const trips = [{ who: 'a', m: measure(coords), eta: r.primaryEtaS }];
      if (route.compare && route.compare.length > 2 && r.compareEtaS) trips.push({ who: 'b', m: measure(route.compare), eta: r.compareEtaS });
      const slowest = Math.max(...trips.map((t) => t.eta));
      const t0 = performance.now();
      const step = (now: number) => {
        const el = now - t0;
        const fade = Math.min(1, el / 200) * (1 - Math.min(1, Math.max(0, el - RACE_MS - 1200) / 400));
        const features: GeoJSON.Feature[] = [];
        for (const t of trips) {
          const f = easeInOut(Math.min(1, el / ((RACE_MS * t.eta) / slowest)));
          features.push({ type: 'Feature', properties: { who: t.who, fade }, geometry: { type: 'LineString', coordinates: t.m.stretch(Math.max(0, f - 0.12), f) } });
          features.push({ type: 'Feature', properties: { who: t.who, fade }, geometry: { type: 'Point', coordinates: t.m.at(f) } });
        }
        raceSrc.setData({ type: 'FeatureCollection', features });
        if (el < RACE_MS + 1600) raf = requestAnimationFrame(step);
        else raceSrc.setData(emptyFC);
      };
      raf = requestAnimationFrame(step);
    };

    const start = performance.now();
    const tick = (now: number) => {
      const k = easeOut(Math.min(1, (now - start) / 700));
      a.setData(line(coords.slice(0, Math.max(2, Math.ceil(coords.length * k)))));
      if (k < 1) raf = requestAnimationFrame(tick);
      else race();
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      raceSrc.setData(emptyFC);
    };
  }, [route, ready, reduce]);

  // ---- junction picking (routes page) ----
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !network) return;
    map.setLayoutProperty('nodes', 'visibility', nodes ? 'visible' : 'none');
    for (const n of network.nodes) {
      map.setFeatureState({ source: 'nodes', id: n.id }, { origin: nodes?.origin === n.id, destination: nodes?.destination === n.id });
    }
  }, [nodes, ready, network]);

  // ---- focus ----
  const focusKey = focus?.join('|') ?? '';
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !network || !focus || !focus.length) return;
    map.fitBounds(bounds(network, focus), { padding: fitPadding(map.getContainer(), paddingRef.current), duration: reduce ? 0 : 600, maxZoom: 15.5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, ready, network, reduce]);

  const resetView = () => {
    const map = mapRef.current;
    if (map && network) map.fitBounds(bounds(network), { padding: fitPadding(map.getContainer(), paddingRef.current), duration: reduce ? 0 : 500 });
  };

  /** Flip the tooltip to the pointer's other side when it would run off the map. */
  const tipSide = (p: { x: number; y: number }) => {
    const el = containerRef.current;
    if (!el) return '';
    return `${p.x > el.clientWidth - 240 ? 'map__tip--left' : ''} ${p.y > el.clientHeight - 110 ? 'map__tip--up' : ''}`;
  };

  const hoverSeg = hover ? segIndex[hover.id] : null;
  const hoverState = hover ? states[hover.id] : null;
  const hoverPred =
    hover && mode === 'forecast' ? predictions?.predictions.find((p) => p.segment_id === hover.id && p.horizon_min === horizon) : null;
  const hoverNode = nodeHover && network ? network.nodes.find((n) => n.id === nodeHover.id) : null;

  return (
    <div className={`map ${className}`}>
      <div ref={containerRef} className="map__canvas" role="region" aria-label={ariaLabel} />
      {!network && <div className="map__loading">Loading the road network…</div>}
      {!basemapOk && <p className="map__note">Basemap unavailable: roads drawn on a plain ground.</p>}
      <div className="map__controls">
        <button type="button" className="map__btn" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn({ duration: reduce ? 0 : 200 })}>
          <Plus size={16} aria-hidden="true" />
        </button>
        <button type="button" className="map__btn" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut({ duration: reduce ? 0 : 200 })}>
          <Minus size={16} aria-hidden="true" />
        </button>
        <button type="button" className="map__btn" aria-label="Show the whole network" onClick={resetView}>
          <Scan size={16} aria-hidden="true" />
        </button>
      </div>
      {showLegend && (
        <div className="map__legend" aria-label="Map legend">
          {(['free', 'moderate', 'heavy', 'severe'] as SegmentLevel[]).map((l) => (
            <span key={l} className="map__legend-item">
              <span className={`map__legend-line map__legend-line--${l}`} aria-hidden="true" />
              {LEVEL_LABEL[l]}
            </span>
          ))}
          {mode === 'forecast' && (
            <span className="map__legend-item">
              <span className="map__legend-line map__legend-line--worse" aria-hidden="true" />
              Worse than now
            </span>
          )}
          {showVehicles && mode === 'now' && (
            <span className="map__legend-item">
              <span className="map__legend-dot" aria-hidden="true" />
              Simulated vehicle
            </span>
          )}
        </div>
      )}
      {hover && hoverSeg && (
        <div className={`map__tip ${tipSide(hover)}`} style={{ left: hover.x, top: hover.y }}>
          <p className="map__tip-title">{hoverSeg.name}</p>
          <p className="map__tip-id mono">{hoverSeg.id}</p>
          {mode === 'forecast' && hoverPred ? (
            <p className="map__tip-row">
              <LevelSwatch level={hoverPred.predicted_level} />
              {LEVEL_LABEL[hoverPred.predicted_level]} in {horizon} min
              <span className="num soft">
                {fmtSpeed(hoverPred.current_speed_kph)} → {fmtSpeed(hoverPred.predicted_speed_kph)} km/h
              </span>
            </p>
          ) : (
            <p className="map__tip-row">
              <LevelSwatch level={hoverState?.level ?? 'no_data'} />
              {LEVEL_LABEL[hoverState?.level ?? 'no_data']}
              <span className="num soft">
                {fmtSpeed(hoverState?.avg_speed_kph)} of {fmtSpeed(hoverSeg.free_flow_kph)} km/h · {fmtInt(hoverState?.vehicle_count)} veh
              </span>
            </p>
          )}
        </div>
      )}
      {nodeHover && hoverNode && (
        <div className={`map__tip ${tipSide(nodeHover)}`} style={{ left: nodeHover.x, top: nodeHover.y }}>
          <p className="map__tip-title">{hoverNode.name}</p>
          <p className="map__tip-id mono">{hoverNode.id}</p>
        </div>
      )}
    </div>
  );
}
