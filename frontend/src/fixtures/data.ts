/**
 * DESIGN FIXTURES: hand-written sample data for building the interface before
 * any backend exists. Loaded only with `--mode fixtures`, behind a banner.
 * Nothing here is model output or simulator output. Road shapes come from
 * OpenStreetMap (ODbL); see docs/COMPLIANCE.md.
 */
import networkJson from './network.json';
import type {
  AnalyticsOverview,
  CongestionAlert,
  CongestionLevel,
  Incident,
  ModelInfo,
  NetworkSummary,
  Prediction,
  PredictionSet,
  RoadNetwork,
  RouteResponse,
  SegmentLevel,
  SegmentState,
  StageStatus,
  SystemStatus,
  ThroughputPoint,
  TrafficHistory,
  TrafficHistoryPoint,
  VehiclePosition,
  VehicleType,
} from '../lib/contract';

export const network = networkJson as unknown as RoadNetwork;
const seg = (id: string) => network.segments.find((s) => s.id === id)!;

/** Seeded random so fixture runs look the same every time. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sample speeds (km/h) for three scenes: settled, building, jammed.
const SPEEDS: Record<string, [number, number, number]> = {
  'ORR-01': [41, 36, 30],
  'ORR-02': [38, 30, 22],
  'ORR-03': [31, 21, 9],
  'ORR-04': [26, 19, 13],
  'HSR-01': [37, 33, 28],
  'HSR-02': [33, 27, 20],
  'HSR-03': [22, 16, 11],
  'SJR-01': [30, 24, 17],
  'SJR-02': [32, 29, 25],
  'SJR-03': [33, 32, 30],
  'KFT-01': [22, 19, 16],
  'IRR-01': [34, 31, 27],
  'IRR-02': [30, 26, 21],
  'M27-01': [26, 25, 22],
  'M19-01': [24, 21, 15],
  'M14-01': [25, 23, 19],
  'TVK-01': [17, 15, 12],
  'M29-01': [23, 20, 16],
  'M29-02': [25, 24, 22],
  'BGR-01': [27, 25, 23],
  'MHM-01': [26, 22, 18],
};

// Sample levels, written out per scene rather than computed, so the frontend never classifies.
const LEVELS: Record<string, [CongestionLevel, CongestionLevel, CongestionLevel]> = {
  'ORR-01': ['free', 'free', 'moderate'],
  'ORR-02': ['free', 'moderate', 'heavy'],
  'ORR-03': ['moderate', 'heavy', 'severe'],
  'ORR-04': ['moderate', 'heavy', 'severe'],
  'HSR-01': ['free', 'free', 'moderate'],
  'HSR-02': ['free', 'moderate', 'heavy'],
  'HSR-03': ['moderate', 'heavy', 'severe'],
  'SJR-01': ['free', 'moderate', 'heavy'],
  'SJR-02': ['free', 'free', 'moderate'],
  'SJR-03': ['free', 'free', 'free'],
  'KFT-01': ['moderate', 'moderate', 'moderate'],
  'IRR-01': ['free', 'free', 'moderate'],
  'IRR-02': ['free', 'moderate', 'moderate'],
  'M27-01': ['free', 'free', 'moderate'],
  'M19-01': ['free', 'free', 'moderate'],
  'M14-01': ['free', 'free', 'moderate'],
  'TVK-01': ['moderate', 'moderate', 'heavy'],
  'M29-01': ['free', 'moderate', 'moderate'],
  'M29-02': ['free', 'free', 'free'],
  'BGR-01': ['free', 'free', 'free'],
  'MHM-01': ['free', 'moderate', 'moderate'],
};

const DENSITY_BY_LEVEL: Record<CongestionLevel, number> = { free: 9, moderate: 16, heavy: 26, severe: 38 };

export const SCENE_ORDER = [0, 1, 2, 2, 1, 0] as const;
export const WINDOW_S = 30;

export function sceneStates(scene: number, prevScene: number | null, windowEnd: Date): SegmentState[] {
  return network.segments.map((s) => {
    const v = SPEEDS[s.id][scene];
    const level = LEVELS[s.id][scene];
    const ff = s.free_flow_kph;
    const ratio = v / ff;
    const km = s.length_m / 1000;
    const density = DENSITY_BY_LEVEL[level] * (s.lanes / 2);
    const count = Math.max(3, Math.round(density * km));
    const prevV = prevScene === null ? v : SPEEDS[s.id][prevScene];
    const slope = (v - prevV) / 2; // two minutes between scenes
    const trend = slope <= -1 ? 'worsening' : slope >= 1 ? 'improving' : 'stable';
    const severity = Math.round(70 * Math.min(1, Math.max(0, (1 - ratio) / 0.85)) + 30 * Math.min(1, density / (120 * s.lanes)));
    return {
      segment_id: s.id,
      window_start: new Date(windowEnd.getTime() - WINDOW_S * 1000).toISOString(),
      window_end: windowEnd.toISOString(),
      avg_speed_kph: v,
      free_flow_kph: ff,
      speed_ratio: Math.round(ratio * 100) / 100,
      speed_reduction_pct: Math.max(0, Math.round((1 - ratio) * 100)),
      vehicle_count: count,
      density_veh_per_km: Math.round(density * 10) / 10,
      flow_veh_per_h: Math.round(density * v),
      level,
      severity,
      trend,
      trend_kph_per_min: Math.round(slope * 10) / 10,
      reason: reasonFor(level, v, ff),
    };
  });
}

function reasonFor(level: CongestionLevel, v: number, ff: number): string {
  const pct = Math.round((v / ff) * 100);
  const head = `Speed ${v} km/h is ${pct}% of free flow (${ff} km/h)`;
  switch (level) {
    case 'free':
      return `${head}: at or above the 75% free-flow threshold.`;
    case 'moderate':
      return `${head}: between 50% and 75%.`;
    case 'heavy':
      return `${head}: between 30% and 50%.`;
    case 'severe':
      return `${head}: below the 30% severe threshold.`;
  }
}

export function summaryOf(states: SegmentState[], asOf: Date, eventsPerS: number, activeIncidents: number): NetworkSummary {
  const byLevel: Record<SegmentLevel, number> = { free: 0, moderate: 0, heavy: 0, severe: 0, no_data: 0 };
  let weighted = 0;
  let length = 0;
  let congested = 0;
  let vehicles = 0;
  for (const st of states) {
    const s = seg(st.segment_id);
    byLevel[st.level] += 1;
    vehicles += st.vehicle_count;
    if (st.avg_speed_kph !== null) {
      weighted += st.avg_speed_kph * s.length_m;
      length += s.length_m;
    }
    if (st.level === 'heavy' || st.level === 'severe') congested += s.length_m;
  }
  return {
    as_of: asOf.toISOString(),
    vehicles_active: vehicles,
    avg_speed_kph: length ? Math.round((weighted / length) * 10) / 10 : null,
    congested_km: Math.round(congested / 100) / 10,
    network_km: Math.round(network.segments.reduce((a, s) => a + s.length_m, 0) / 100) / 10,
    segments_by_level: byLevel,
    events_per_s: eventsPerS,
    active_incidents: activeIncidents,
  };
}

// ---------- predictions ----------

export const MODEL: ModelInfo = {
  name: 'congestion-forecast',
  version: 'fixture',
  region: 'blr',
  kind: 'rule_baseline',
  description: 'Design fixture. Sample numbers for layout only; the real model card comes from the API.',
  trained_at: null,
  training_windows: 0,
  evaluated_at: '2026-11-24T09:00:00Z',
  evaluation: [
    { horizon_min: 5, mae_kph: 2.4, rmse_kph: 3.3, baseline_mae_kph: 3.1, baseline_rmse_kph: 4.2, n: 1840 },
    { horizon_min: 10, mae_kph: 3.6, rmse_kph: 4.9, baseline_mae_kph: 4.8, baseline_rmse_kph: 6.4, n: 1820 },
    { horizon_min: 15, mae_kph: 4.7, rmse_kph: 6.2, baseline_mae_kph: 6.0, baseline_rmse_kph: 7.9, n: 1800 },
  ],
};

const levelAt = (v: number, ff: number): CongestionLevel => {
  const r = v / ff;
  return r >= 0.75 ? 'free' : r >= 0.5 ? 'moderate' : r >= 0.3 ? 'heavy' : 'severe';
};

const DRIVERS: Record<string, string[]> = {
  'ORR-02': ['Speed falling 4 km/h per min', 'Agara density up 38% in 5 min'],
  'ORR-03': ['Speed falling 5 km/h per min', 'Queue from Silk Board Junction growing'],
  'ORR-04': ['Silk Board Junction outflow down 30%'],
  'HSR-02': ['Speed falling 3 km/h per min', 'Downstream Hosur Road is heavy'],
  'HSR-03': ['Queue backing up from Silk Board Junction'],
  'SJR-01': ['Iblur Junction density up 41%'],
  'M19-01': ['Drivers leaving Outer Ring Road through HSR Layout'],
  'TVK-01': ['Speed falling 1.5 km/h per min'],
};

export function scenePredictions(scene: number, nextScene: number, madeAt: Date): PredictionSet {
  const predictions: Prediction[] = [];
  for (const s of network.segments) {
    const now = SPEEDS[s.id][scene];
    const next = SPEEDS[s.id][nextScene];
    for (const h of [5, 10, 15]) {
      const pull = h === 5 ? 0.45 : h === 10 ? 0.85 : 1.05;
      const p = Math.max(3, Math.round((now + (next - now) * pull) * 10) / 10);
      const half = 1.6 + 0.22 * h;
      const lo = Math.max(2, p - half);
      const hi = Math.min(s.free_flow_kph * 1.05, p + half);
      const heavyAt = 0.5 * s.free_flow_kph;
      const risk = hi <= heavyAt ? 1 : lo >= heavyAt ? 0 : (heavyAt - lo) / (hi - lo);
      predictions.push({
        segment_id: s.id,
        made_at: madeAt.toISOString(),
        horizon_min: h,
        target_time: new Date(madeAt.getTime() + h * 60_000).toISOString(),
        current_speed_kph: now,
        predicted_speed_kph: p,
        expected_change_kph: Math.round((p - now) * 10) / 10,
        interval_kph: [Math.round(lo * 10) / 10, Math.round(hi * 10) / 10],
        predicted_level: levelAt(p, s.free_flow_kph),
        risk: Math.round(risk * 100) / 100,
        drivers: next < now ? (DRIVERS[s.id] ?? ['Speed trending down']) : next > now ? ['Speed recovering'] : ['No change expected'],
      });
    }
  }
  return { made_at: madeAt.toISOString(), horizons: [5, 10, 15], model: MODEL, predictions };
}

// ---------- incidents ----------

export function baseIncidents(now: Date): Incident[] {
  const t = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
  return [
    {
      incident_id: 'INC-0412',
      segment_id: 'TVK-01',
      type: 'unusual_density',
      severity: 'low',
      status: 'resolved',
      detected_at: t(96),
      updated_at: t(71),
      resolved_at: t(71),
      reason: 'Density reached 3.6 standard deviations above the usual figure for this time of day, with no drop in speed.',
      evidence: [
        { metric: 'density_veh_per_km', label: 'Density', baseline: 14.2, observed: 31.5, unit: 'veh/km' },
        { metric: 'avg_speed_kph', label: 'Speed', baseline: 17, observed: 16, unit: 'km/h' },
      ],
      affected_segments: ['TVK-01'],
      conditions: { avg_speed_kph: 16, vehicle_count: 38, density_veh_per_km: 31.5, flow_veh_per_h: 504, level: 'moderate' },
      timeline: [
        { ts: t(96), kind: 'detected', note: 'Density z-score 3.6' },
        { ts: t(71), kind: 'resolved', note: 'Four normal windows in a row' },
      ],
      simulated: true,
    },
    {
      incident_id: 'INC-0413',
      segment_id: 'SJR-01',
      type: 'flow_breakdown',
      severity: 'medium',
      status: 'resolved',
      detected_at: t(58),
      updated_at: t(31),
      resolved_at: t(31),
      reason: 'Flow fell 41% while density upstream at Iblur Junction rose 33%.',
      evidence: [
        { metric: 'flow_veh_per_h', label: 'Flow', baseline: 1180, observed: 696, unit: 'veh/h' },
        { metric: 'upstream_density', label: 'Upstream density', baseline: 12.4, observed: 16.5, unit: 'veh/km' },
      ],
      affected_segments: ['SJR-01', 'ORR-02'],
      conditions: { avg_speed_kph: 19, vehicle_count: 41, density_veh_per_km: 25.4, flow_veh_per_h: 483, level: 'heavy' },
      timeline: [
        { ts: t(58), kind: 'detected', note: 'Flow down 41%' },
        { ts: t(49), kind: 'updated', note: 'Upstream density still rising' },
        { ts: t(31), kind: 'resolved', note: 'Four normal windows in a row' },
      ],
      simulated: true,
    },
  ];
}

export function speedDropIncident(now: Date): Incident {
  const iso = now.toISOString();
  return {
    incident_id: 'INC-0414',
    segment_id: 'HSR-03',
    type: 'sudden_speed_drop',
    severity: 'high',
    status: 'active',
    detected_at: iso,
    updated_at: iso,
    resolved_at: null,
    reason: 'Speed fell 42% in one minute, from 22 to 16 km/h, against a usual 21 km/h at this hour (z = −3.4).',
    evidence: [
      { metric: 'avg_speed_kph', label: 'Speed', baseline: 22, observed: 16, unit: 'km/h' },
      { metric: 'speed_z', label: 'Speed z-score', baseline: 0, observed: -3.4, unit: 'σ' },
    ],
    affected_segments: ['HSR-03', 'HSR-02'],
    conditions: { avg_speed_kph: 16, vehicle_count: 34, density_veh_per_km: 39, flow_veh_per_h: 624, level: 'heavy' },
    timeline: [{ ts: iso, kind: 'detected', note: 'Speed down 42% within two windows' }],
    simulated: true,
  };
}

export function blockageIncident(now: Date): Incident {
  const iso = now.toISOString();
  return {
    incident_id: 'INC-0415',
    segment_id: 'ORR-03',
    type: 'possible_blockage',
    severity: 'critical',
    status: 'active',
    detected_at: iso,
    updated_at: iso,
    resolved_at: null,
    reason: 'Vehicles near standstill (9 km/h) for two windows while flow out of the segment fell 56%: the pattern of a blocked lane.',
    evidence: [
      { metric: 'avg_speed_kph', label: 'Speed', baseline: 31, observed: 9, unit: 'km/h' },
      { metric: 'downstream_flow', label: 'Flow into Silk Board Junction', baseline: 1420, observed: 625, unit: 'veh/h' },
      { metric: 'density_veh_per_km', label: 'Density', baseline: 24, observed: 57, unit: 'veh/km' },
    ],
    affected_segments: ['ORR-03', 'ORR-02', 'M19-01'],
    conditions: { avg_speed_kph: 9, vehicle_count: 159, density_veh_per_km: 57, flow_veh_per_h: 513, level: 'severe' },
    timeline: [
      { ts: new Date(now.getTime() - 60_000).toISOString(), kind: 'detected', note: 'Speed under 10 km/h with flow falling' },
      { ts: iso, kind: 'escalated', note: 'Second window confirms; severity raised to critical' },
    ],
    simulated: true,
  };
}

// ---------- alerts ----------

export function alertsBetween(prev: SegmentState[], next: SegmentState[], at: Date, counter: { n: number }): CongestionAlert[] {
  const rank = { no_data: -1, free: 0, moderate: 1, heavy: 2, severe: 3 } as const;
  const out: CongestionAlert[] = [];
  for (const n of next) {
    const p = prev.find((x) => x.segment_id === n.segment_id);
    if (!p || p.level === n.level) continue;
    const up = rank[n.level] > rank[p.level];
    if (up && rank[n.level] < 2) continue;
    if (!up && rank[p.level] < 2) continue;
    const s = seg(n.segment_id);
    counter.n += 1;
    out.push({
      alert_id: `ALT-${String(counter.n).padStart(4, '0')}`,
      segment_id: n.segment_id,
      kind: up ? (p.level === 'free' || p.level === 'moderate' ? 'emerging' : 'escalated') : 'cleared',
      level_from: p.level,
      level_to: n.level,
      raised_at: at.toISOString(),
      message: up
        ? `${s.name} slowed to ${n.avg_speed_kph} km/h, ${n.speed_reduction_pct}% under free flow.`
        : `${s.name} recovered to ${n.avg_speed_kph} km/h.`,
    });
  }
  return out;
}

// ---------- vehicles ----------

const TYPES: [VehicleType, number][] = [
  ['two_wheeler', 0.45],
  ['car', 0.3],
  ['auto_rickshaw', 0.12],
  ['truck', 0.07],
  ['bus', 0.06],
];

interface FixtureVehicle {
  id: string;
  type: VehicleType;
  segment: string;
  d: number;
  dir: 1 | -1;
  jitter: number;
}

export function createFleet(seed = 2026, size = 160): FixtureVehicle[] {
  const rand = mulberry32(seed);
  const total = network.segments.reduce((a, s) => a + s.length_m * s.lanes, 0);
  const fleet: FixtureVehicle[] = [];
  let i = 0;
  for (const s of network.segments) {
    const n = Math.max(2, Math.round((size * s.length_m * s.lanes) / total));
    for (let k = 0; k < n; k++) {
      let r = rand();
      let type: VehicleType = 'car';
      for (const [t, share] of TYPES) {
        if (r < share) {
          type = t;
          break;
        }
        r -= share;
      }
      i += 1;
      fleet.push({ id: `SIM-V-${String(i).padStart(4, '0')}`, type, segment: s.id, d: rand() * s.length_m, dir: rand() < 0.5 ? 1 : -1, jitter: 0.8 + rand() * 0.4 });
    }
  }
  return fleet;
}

function pointAlong(geometry: [number, number][], dist: number): { lng: number; lat: number; heading: number } {
  let remaining = dist;
  for (let i = 0; i < geometry.length - 1; i++) {
    const [x1, y1] = geometry[i];
    const [x2, y2] = geometry[i + 1];
    const dx = (x2 - x1) * 111_320 * Math.cos((y1 * Math.PI) / 180);
    const dy = (y2 - y1) * 110_540;
    const len = Math.hypot(dx, dy);
    if (remaining <= len || i === geometry.length - 2) {
      const f = len === 0 ? 0 : Math.min(1, remaining / len);
      const heading = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
      return { lng: x1 + (x2 - x1) * f, lat: y1 + (y2 - y1) * f, heading };
    }
    remaining -= len;
  }
  const [x, y] = geometry[geometry.length - 1];
  return { lng: x, lat: y, heading: 0 };
}

/** Moves the fixture fleet along its segments at each segment's sample speed. */
export function stepFleet(fleet: FixtureVehicle[], states: Record<string, SegmentState>, dtS: number, at: Date): VehiclePosition[] {
  const out: VehiclePosition[] = [];
  for (const v of fleet) {
    const s = seg(v.segment);
    const speed = Math.max(2, (states[v.segment]?.avg_speed_kph ?? s.free_flow_kph) * v.jitter);
    v.d += v.dir * (speed / 3.6) * dtS;
    if (v.d > s.length_m) v.d -= s.length_m;
    if (v.d < 0) v.d += s.length_m;
    const p = pointAlong(s.geometry, v.d);
    out.push({
      vehicle_id: v.id,
      vehicle_type: v.type,
      lng: p.lng,
      lat: p.lat,
      speed_kph: Math.round(speed),
      heading_deg: Math.round(v.dir === 1 ? p.heading : (p.heading + 180) % 360),
      segment_id: v.segment,
      ts: at.toISOString(),
    });
  }
  return out;
}

// ---------- history, analytics, system ----------

export function trafficHistory(now: Date, minutes: number): TrafficHistory {
  const mk = (offsetMin: number, scale: number): TrafficHistoryPoint[] => {
    const pts: TrafficHistoryPoint[] = [];
    for (let i = minutes; i >= 0; i--) {
      const ts = new Date(now.getTime() - (i + offsetMin) * 60_000);
      const x = (minutes - i) / minutes;
      const speed = 31 - 9 * scale * Math.sin(x * Math.PI * 0.9) ** 2 + Math.sin(i * 1.7) * 0.6;
      const congested = Math.max(0, 2 + 9 * scale * Math.sin(x * Math.PI * 0.9) ** 2);
      pts.push({
        ts: ts.toISOString(),
        avg_speed_kph: Math.round(speed * 10) / 10,
        vehicles: Math.round(380 + 140 * scale * x),
        congested_km: Math.round(congested * 10) / 10,
        by_level: { free: 0, moderate: 0, heavy: 0, severe: 0, no_data: 0 },
      });
    }
    return pts;
  };
  return {
    minutes,
    points: mk(0, 1),
    comparison: { label: 'Same time, previous simulated day', points: mk(0, 0.7).map((p) => ({ ...p })) },
  };
}

export function analytics(days: number, now: Date): AnalyticsOverview {
  const curve = (h: number) => Math.exp(-((h - 9.5) ** 2) / 3.2) + 0.85 * Math.exp(-((h - 18.5) ** 2) / 4);
  const hourly = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    avg_speed_kph: Math.round((34 - 15 * curve(h)) * 10) / 10,
    congested_share: Math.round(Math.min(0.9, 0.04 + 0.55 * curve(h)) * 100) / 100,
    vehicles: Math.round(120 + 520 * curve(h) + (h > 6 && h < 22 ? 140 : 0)),
  }));
  const weight: Record<string, number> = { 'ORR-03': 1, 'ORR-04': 0.95, 'HSR-03': 0.9, 'ORR-02': 0.8, 'SJR-01': 0.7, 'HSR-02': 0.65, 'TVK-01': 0.6, 'KFT-01': 0.55 };
  const heat = network.segments.flatMap((s) =>
    Array.from({ length: 24 }, (_, h) => ({
      segment_id: s.id,
      hour: h,
      congested_share: Math.round(Math.min(1, (weight[s.id] ?? 0.25) * (0.05 + 0.95 * curve(h))) * 100) / 100,
    })),
  );
  const segments = network.segments.map((s) => {
    const w = weight[s.id] ?? 0.25;
    const avg = Math.round(s.free_flow_kph * (0.9 - 0.4 * w) * 10) / 10;
    const p15 = Math.round(avg * (0.75 - 0.35 * w) * 10) / 10;
    return {
      segment_id: s.id,
      avg_speed_kph: avg,
      p15_speed_kph: p15,
      congested_minutes: Math.round(days * 1440 * w * 0.16),
      congestion_episodes: Math.round(days * (1 + 6 * w)),
      incidents: Math.round(days * w * 0.6),
      reliability: Math.round((p15 / s.free_flow_kph) * 100) / 100,
    };
  });
  const flow = Array.from({ length: 48 }, (_, i) => {
    const ts = new Date(now.getTime() - (47 - i) * 30 * 60_000);
    const h = (ts.getUTCHours() + 5.5) % 24;
    return {
      ts: ts.toISOString(),
      flow_veh_per_h: Math.round(9000 + 21000 * curve(h)),
      avg_speed_kph: Math.round((34 - 15 * curve(h)) * 10) / 10,
      vehicles: Math.round(120 + 520 * curve(h)),
    };
  });
  return {
    from: new Date(now.getTime() - days * 86_400_000).toISOString(),
    to: now.toISOString(),
    simulated_days: days,
    hourly,
    peak_hours: [8, 9, 10, 18, 19],
    heat,
    segments,
    flow,
  };
}

export function systemStatus(now: Date, rand: () => number, lastVehicle: VehiclePosition | null): SystemStatus {
  const base = 182 + Math.round((rand() - 0.5) * 18);
  const valid = base - 3;
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const stages: StageStatus[] = [
    { id: 'simulator', name: 'Telemetry simulator', kind: 'producer', runs_on: 'local', status: 'ok', events_in_per_s: 0, events_out_per_s: base, last_event_at: ago(120), errors_total: 0, downstream: ['telemetry-raw'] },
    { id: 'telemetry-raw', name: 'telemetry-raw', kind: 'topic', runs_on: 'kafka', status: 'ok', events_in_per_s: base, events_out_per_s: base, last_event_at: ago(140), errors_total: 0, downstream: ['validate'] },
    { id: 'validate', name: 'validate-telemetry', kind: 'transform', runs_on: 'condense', status: 'ok', events_in_per_s: base, events_out_per_s: valid, last_event_at: ago(260), errors_total: 1342, downstream: ['window'] },
    { id: 'window', name: 'segment-window', kind: 'transform', runs_on: 'condense', status: 'ok', events_in_per_s: valid, events_out_per_s: 0.7, last_event_at: ago(900), errors_total: 0, downstream: ['split', 'incidents', 'forecast'] },
    { id: 'split', name: 'Split: level changes', kind: 'utility', runs_on: 'condense', status: 'ok', events_in_per_s: 0.7, events_out_per_s: 0.05, last_event_at: ago(14_000), errors_total: 0, downstream: ['api'] },
    { id: 'incidents', name: 'incident-detector', kind: 'transform', runs_on: 'condense', status: 'ok', events_in_per_s: 0.7, events_out_per_s: 0.01, last_event_at: ago(41_000), errors_total: 0, downstream: ['api'] },
    { id: 'forecast', name: 'congestion-forecast', kind: 'transform', runs_on: 'condense', status: 'ok', events_in_per_s: 0.7, events_out_per_s: 2.1, last_event_at: ago(900), errors_total: 0, downstream: ['api'] },
    { id: 'api', name: 'Arterial API', kind: 'api', runs_on: 'local', status: 'ok', events_in_per_s: 2.9, events_out_per_s: 0, last_event_at: ago(320), errors_total: 0, downstream: [] },
  ];
  const p50 = 410 + Math.round(rand() * 60);
  return {
    as_of: now.toISOString(),
    kafka: { connected: true, bootstrap_host: 'fixture.kafka.example', last_error: null, reconnects: 0 },
    stages,
    consumers: [
      { group: 'team.api', topic: 'team.segment-metrics', lag: Math.round(rand() * 4), status: 'ok', last_commit_at: ago(900) },
      { group: 'team.api', topic: 'team.incidents', lag: 0, status: 'ok', last_commit_at: ago(41_000) },
      { group: 'team.api', topic: 'team.predictions', lag: Math.round(rand() * 6), status: 'ok', last_commit_at: ago(900) },
      { group: 'team.api', topic: 'team.congestion-alerts', lag: 0, status: 'ok', last_commit_at: ago(14_000) },
      { group: 'team.api', topic: 'team.telemetry-rejected', lag: 12, status: 'degraded', last_commit_at: ago(6_000) },
    ],
    throughput: { in_per_s: base, out_per_s: valid },
    latency_ms: { p50, p95: p50 + 380 + Math.round(rand() * 120), max: p50 + 1400 },
    last_event: lastVehicle
      ? { event_id: `fx-${Math.round(rand() * 1e9).toString(16)}`, vehicle_id: lastVehicle.vehicle_id, segment_id: lastVehicle.segment_id, ts: ago(450), processed_at: now.toISOString() }
      : null,
    errors: { validation_rejected: 1342, duplicates_dropped: 611, late_events: 87, consumer_errors: 0 },
    simulation: { running: true, scenario: 'gradual build-up', seed: 2026, vehicles: 160, target_rate: 180 },
  };
}

export function throughputHistory(now: Date, rand: () => number): ThroughputPoint[] {
  return Array.from({ length: 90 }, (_, i) => {
    const base = 178 + Math.round((rand() - 0.5) * 20);
    return {
      ts: new Date(now.getTime() - (89 - i) * 10_000).toISOString(),
      in_per_s: base,
      out_per_s: base - 3,
      p95_ms: 820 + Math.round(rand() * 160),
    };
  });
}

// ---------- route ----------

export function fixtureRoute(origin: string, destination: string, states: Record<string, SegmentState>, now: Date): RouteResponse | null {
  if (origin !== 'N04' || destination !== 'N02') return null;
  const ids = ['ORR-03', 'ORR-02'];
  const geometry = ids.flatMap((id) => [...seg(id).geometry].reverse()) as [number, number][];
  const exposure: Record<SegmentLevel, number> = { free: 0, moderate: 0, heavy: 0, severe: 0, no_data: 0 };
  let eta = 0;
  let ff = 0;
  let dist = 0;
  for (const id of ids) {
    const s = seg(id);
    const st = states[id];
    exposure[st?.level ?? 'no_data'] += s.length_m;
    eta += s.length_m / ((st?.avg_speed_kph ?? s.free_flow_kph) / 3.6);
    ff += s.length_m / (s.free_flow_kph / 3.6);
    dist += s.length_m;
  }
  const option = {
    node_ids: ['N04', 'N03', 'N02'],
    segment_ids: ids,
    distance_m: dist,
    eta_s: Math.round(eta),
    free_flow_eta_s: Math.round(ff),
    delay_s: Math.round(eta - ff),
    exposure_m: exposure,
    geometry,
  };
  return {
    as_of: now.toISOString(),
    origin,
    destination,
    algorithm: 'a_star',
    recommended: option,
    alternative: null,
    free_flow_fastest: option,
    time_saved_s: 0,
    explanation: [
      'Design fixture: the sample network has one path between these junctions, so there is no detour to compare.',
      'The real route engine searches the full road graph with A* during the build window.',
    ],
  };
}
