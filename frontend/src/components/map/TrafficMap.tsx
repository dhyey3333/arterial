import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cubicBezier, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Scan } from 'lucide-react';
import type { Incident, LngLat, RoadNetwork, RoadNode, SegmentLevel } from '../../lib/contract';
import { LEVEL_LABEL, LEVEL_RANK, fmtInt, fmtSpeed } from '../../lib/format';
import { useLive } from '../../data/store';
import { loadBasemap } from './basemap';
import { LevelSwatch } from '../ui/primitives';

const LEVEL_RGB: Record<SegmentLevel, [number, number, number]> = {
  free: [12, 163, 12],
  moderate: [250, 178, 25],
  heavy: [236, 131, 90],
  severe: [208, 59, 59],
  no_data: [74, 85, 102],
};
/** Width steps double the colour channel, because warning and serious sit close in hue. */
const LEVEL_WIDTH: Record<SegmentLevel, number> = { no_data: 0.8, free: 1, moderate: 1.25, heavy: 1.55, severe: 1.9 };
const LEVEL_OPACITY: Record<SegmentLevel, number> = { no_data: 0.7, free: 0.78, moderate: 1, heavy: 1, severe: 1 };

const easeInOut = cubicBezier(0.77, 0, 0.175, 1);
const easeOut = cubicBezier(0.23, 1, 0.32, 1);
const COLOR_MS = 600;

export interface MapRoute {
  primary: LngLat[];
  compare?: LngLat[] | null;
}

export interface TrafficMapProps {
  ariaLabel: string;
  mode?: 'now' | 'forecast';
  horizon?: number;
  selectedSegment?: string | null;
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

/** Padding that still leaves room to fit the network on a small screen. */
function fitPadding(el: HTMLElement, p: { top: number; right: number; bottom: number; left: number }) {
  const w = el.clientWidth || 800;
  const h = el.clientHeight || 600;
  return {
    top: Math.min(p.top, h * 0.22),
    bottom: Math.min(p.bottom, h * 0.14),
    left: Math.min(p.left, w * 0.08),
    right: Math.min(p.right, w * 0.08),
  };
}

function addLayers(map: MLMap, net: RoadNetwork) {
  map.addSource('segments', {
    type: 'geojson',
    promoteId: 'id',
    data: {
      type: 'FeatureCollection',
      features: net.segments.map((s) => ({
        type: 'Feature',
        properties: { id: s.id, name: s.name },
        geometry: { type: 'LineString', coordinates: s.geometry },
      })),
    },
  });
  const w = (base: number, top: number) =>
    ['interpolate', ['linear'], ['zoom'], 11, ['*', ['coalesce', ['feature-state', 'w'], 1], base], 16, ['*', ['coalesce', ['feature-state', 'w'], 1], top]] as unknown as number;

  map.addLayer({
    id: 'seg-halo',
    type: 'line',
    source: 'segments',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#e8edf3',
      'line-width': w(7, 16),
      'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.32, ['boolean', ['feature-state', 'hover'], false], 0.18, 0],
    },
  });
  map.addLayer({
    id: 'seg-casing',
    type: 'line',
    source: 'segments',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#06080c', 'line-width': w(4.2, 10), 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'seg-line',
    type: 'line',
    source: 'segments',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['coalesce', ['feature-state', 'color'], '#4a5566'],
      'line-width': w(2.4, 6.5),
      'line-opacity': ['coalesce', ['feature-state', 'opacity'], 0.8],
    },
  });
  map.addLayer({
    id: 'seg-worse',
    type: 'line',
    source: 'segments',
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': '#06080c',
      'line-width': w(1.2, 2.4),
      'line-dasharray': [1.5, 2],
      'line-opacity': ['case', ['boolean', ['feature-state', 'worse'], false], 0.85, 0],
    },
  });

  map.addSource('route-b', { type: 'geojson', data: emptyFC });
  map.addSource('route-a', { type: 'geojson', data: emptyFC });
  map.addLayer({
    id: 'route-b-line',
    type: 'line',
    source: 'route-b',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#c3cbd6', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 4], 'line-dasharray': [1.2, 1.6], 'line-opacity': 0.75 },
  });
  map.addLayer({
    id: 'route-a-casing',
    type: 'line',
    source: 'route-a',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#06080c', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 7, 16, 14] },
  });
  map.addLayer({
    id: 'route-a-line',
    type: 'line',
    source: 'route-a',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#3fd4e4', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3.5, 16, 8] },
  });

  map.addSource('vehicles', { type: 'geojson', data: emptyFC });
  map.addLayer({
    id: 'vehicles',
    type: 'circle',
    source: 'vehicles',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 14, 2.6, 17, 4.5],
      'circle-color': '#d9e7f7',
      'circle-opacity': 0.92,
      'circle-stroke-color': '#06080c',
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
      'circle-color': ['case', ['boolean', ['feature-state', 'origin'], false], '#3fd4e4', ['boolean', ['feature-state', 'destination'], false], '#e8edf3', '#121821'],
      'circle-stroke-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#e8edf3', '#a3afbf'],
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'seg-hit',
    type: 'line',
    source: 'segments',
    paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 16 },
  });
}

export function TrafficMap({
  ariaLabel,
  mode = 'now',
  horizon = 10,
  selectedSegment = null,
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
          minZoom: 10,
          maxZoom: 18,
          fadeDuration: 0,
        });
        map.touchZoomRotate.disableRotation();
        map.keyboard.disableRotation();
        map.addControl(
          new maplibregl.AttributionControl({ compact: true, customAttribution: ok ? undefined : 'Road shapes © OpenStreetMap contributors' }),
          'bottom-right',
        );
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
  const targets = useMemo(() => {
    const out = new Map<string, { level: SegmentLevel; worse: boolean }>();
    if (!network) return out;
    const byHorizon = new Map<string, SegmentLevel>();
    if (mode === 'forecast' && predictions) {
      for (const p of predictions.predictions) if (p.horizon_min === horizon) byHorizon.set(p.segment_id, p.predicted_level);
    }
    for (const s of network.segments) {
      const now = states[s.id]?.level ?? 'no_data';
      const level = mode === 'forecast' ? (byHorizon.get(s.id) ?? 'no_data') : now;
      out.set(s.id, { level, worse: mode === 'forecast' && LEVEL_RANK[level] > LEVEL_RANK[now] });
    }
    return out;
  }, [network, states, predictions, mode, horizon]);

  const current = useRef(new Map<string, { rgb: [number, number, number]; w: number }>());
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const anims: { id: string; from: { rgb: [number, number, number]; w: number }; to: { rgb: [number, number, number]; w: number } }[] = [];
    for (const [id, t] of targets) {
      const to = { rgb: LEVEL_RGB[t.level], w: LEVEL_WIDTH[t.level] };
      const from = current.current.get(id);
      map.setFeatureState({ source: 'segments', id }, { opacity: LEVEL_OPACITY[t.level], worse: t.worse });
      if (!from || reduce) {
        current.current.set(id, to);
        map.setFeatureState({ source: 'segments', id }, { color: `rgb(${to.rgb.join(',')})`, w: to.w });
      } else if (from.rgb.join() !== to.rgb.join() || from.w !== to.w) {
        anims.push({ id, from, to });
      }
    }
    if (!anims.length) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = easeInOut(Math.min(1, (now - start) / COLOR_MS));
      for (const a of anims) {
        const rgb = a.from.rgb.map((c, i) => Math.round(c + (a.to.rgb[i] - c) * k)) as [number, number, number];
        const w = a.from.w + (a.to.w - a.from.w) * k;
        current.current.set(a.id, { rgb, w });
        map.setFeatureState({ source: 'segments', id: a.id }, { color: `rgb(${rgb.join(',')})`, w });
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

  // ---- vehicles: interpolate between 1 s frames so movement is continuous ----
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource('vehicles') as GeoJSONSource | undefined;
    if (!src) return;
    if (!showVehicles) {
      src.setData(emptyFC);
      return;
    }
    const pos = new Map<string, { fx: number; fy: number; tx: number; ty: number }>();
    let t0 = performance.now();
    let dur = 1000;
    let lastFrame = 0;
    let raf = 0;
    let lastPush = 0;

    const progress = (now: number) => (reduce ? 1 : Math.min(1, (now - t0) / dur));
    const push = (k: number) => {
      const features: GeoJSON.Feature[] = [];
      for (const [id, p] of pos) {
        features.push({ type: 'Feature', id, properties: {}, geometry: { type: 'Point', coordinates: [p.fx + (p.tx - p.fx) * k, p.fy + (p.ty - p.fy) * k] } });
      }
      src.setData({ type: 'FeatureCollection', features });
    };
    const frame = (now: number) => {
      const k = progress(now);
      if (now - lastPush >= 33 || k >= 1) {
        push(k);
        lastPush = now;
      }
      raf = k < 1 ? requestAnimationFrame(frame) : 0;
    };
    const onVehicles = (list: { vehicle_id: string; lng: number; lat: number }[]) => {
      const now = performance.now();
      const k = progress(now);
      const seen = new Set<string>();
      for (const v of list) {
        seen.add(v.vehicle_id);
        const prev = pos.get(v.vehicle_id);
        const fx = prev ? prev.fx + (prev.tx - prev.fx) * k : v.lng;
        const fy = prev ? prev.fy + (prev.ty - prev.fy) * k : v.lat;
        // a jump of over ~300 m is a wrap or a reroute: place it, do not slide it
        const far = prev && Math.hypot(v.lng - fx, v.lat - fy) > 0.003;
        pos.set(v.vehicle_id, far ? { fx: v.lng, fy: v.lat, tx: v.lng, ty: v.lat } : { fx, fy, tx: v.lng, ty: v.lat });
      }
      for (const id of [...pos.keys()]) if (!seen.has(id)) pos.delete(id);
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

  // ---- incidents: pulsing markers at the segment's midpoint ----
  const incidentKey = incidents.map((i) => `${i.incident_id}:${i.severity}`).join('|');
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const markers = incidents
      .filter((i) => segIndex[i.segment_id])
      .map((i) => {
        const el = document.createElement('div');
        el.className = `incident-marker incident-marker--${i.severity}`;
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', `Active incident on ${segIndex[i.segment_id].name}`);
        el.innerHTML = '<span class="incident-marker__ring"></span><span class="incident-marker__core"></span>';
        return new maplibregl.Marker({ element: el }).setLngLat(midpoint(segIndex[i.segment_id].geometry)).addTo(map);
      });
    return () => markers.forEach((m) => m.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentKey, ready, segIndex]);

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
    if (reduce || coords.length < 3) {
      a.setData(line(coords));
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = easeOut(Math.min(1, (now - start) / 700));
      a.setData(line(coords.slice(0, Math.max(2, Math.ceil(coords.length * k)))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
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
        <div className="map__tip" style={{ left: hover.x, top: hover.y }}>
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
        <div className="map__tip" style={{ left: nodeHover.x, top: nodeHover.y }}>
          <p className="map__tip-title">{hoverNode.name}</p>
          <p className="map__tip-id mono">{hoverNode.id}</p>
        </div>
      )}
    </div>
  );
}
