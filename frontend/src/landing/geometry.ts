import type { LngLat, RoadNetwork, SegmentLevel } from '../lib/contract';
// The road shapes only (OpenStreetMap, ODbL): the landing draws the network even when no API answers.
import bundled from '../fixtures/network.json';

export interface PlaneSegment {
  id: string;
  name: string;
  fromNode: string;
  toNode: string;
  lengthM: number;
  freeFlowKph: number;
  d: string;
  /** Points along the road in plane units, evenly spaced, for moving things along it. */
  pts: [number, number][];
  /** Distance of the segment's middle from the network's centre, 0..1: the draw-in starts at the middle. */
  fromCentre: number;
}

export interface Plane {
  w: number;
  h: number;
  segments: PlaneSegment[];
  nodes: { id: string; name: string; x: number; y: number }[];
  /** A plane point back to longitude and latitude, for drawing the plane's traffic on a real map. */
  toLngLat: (x: number, y: number) => LngLat;
  /** [west, south, east, north] of the network. */
  bbox: [number, number, number, number];
}

export const LEVEL_HEX: Record<SegmentLevel, string> = {
  free: '#22c55e',
  moderate: '#fab219',
  heavy: '#ec835a',
  severe: '#e5484d',
  no_data: '#636363',
};

export const LEVEL_RGB: Record<SegmentLevel, [number, number, number]> = {
  free: [34, 197, 94],
  moderate: [250, 178, 25],
  heavy: [236, 131, 90],
  severe: [229, 72, 77],
  no_data: [91, 100, 114],
};

function resample(pts: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    let at = step - carry;
    while (at <= seg) {
      const k = at / seg;
      out.push([x0 + (x1 - x0) * k, y0 + (y1 - y0) * k]);
      at += step;
    }
    carry = seg - (at - step);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** The network from the API, or the bundled road shapes while there is none. */
export function networkOrBundled(network: RoadNetwork | null): RoadNetwork {
  return network ?? (bundled as unknown as RoadNetwork);
}

/** Projects the network to a plane `w` units wide (height follows the network's shape). */
export function toPlane(network: RoadNetwork | null, w = 1000, pad = 40): Plane {
  const net = networkOrBundled(network);
  const lat0 = 12.93;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const P = ([lng, lat]: LngLat): [number, number] => [lng * k, -lat];
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const s of net.segments)
    for (const c of s.geometry) {
      const [x, y] = P(c);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  const sc = (w - 2 * pad) / (x1 - x0);
  const h = Math.round((y1 - y0) * sc + 2 * pad);
  const T = (c: LngLat): [number, number] => {
    const [x, y] = P(c);
    return [(x - x0) * sc + pad, (y - y0) * sc + pad];
  };
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.hypot(cx, cy);
  const segments = net.segments.map((s) => {
    const raw = s.geometry.map(T);
    const mid = raw[Math.floor(raw.length / 2)];
    return {
      id: s.id,
      name: s.name,
      fromNode: s.from_node,
      toNode: s.to_node,
      lengthM: s.length_m,
      freeFlowKph: s.free_flow_kph,
      d: 'M' + raw.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L'),
      pts: resample(raw, 3),
      fromCentre: Math.min(1, Math.hypot(mid[0] - cx, mid[1] - cy) / maxR),
    };
  });
  const nodes = net.nodes.map((n) => {
    const [x, y] = T([n.lng, n.lat]);
    return { id: n.id, name: n.name, x, y };
  });
  const toLngLat = (x: number, y: number): LngLat => [((x - pad) / sc + x0) / k, -((y - pad) / sc + y0)];
  const bbox: [number, number, number, number] = [x0 / k, -y1, x1 / k, -y0];
  return { w, h, segments, nodes, toLngLat, bbox };
}

/** A point `t` (0..1, wrapping) along a resampled road. */
export function pointAt(pts: [number, number][], t: number): [number, number] {
  const u = ((t % 1) + 1) % 1;
  const f = u * (pts.length - 1);
  const i = Math.floor(f);
  const k = f - i;
  const a = pts[i];
  const b = pts[Math.min(i + 1, pts.length - 1)];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}
