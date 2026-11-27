import { create } from 'zustand';
import type {
  CongestionAlert,
  Incident,
  NetworkSummary,
  PredictionSet,
  RoadNetwork,
  RoadSegment,
  SegmentState,
  StreamEventMap,
  StreamEventType,
  SystemStatus,
  ThroughputPoint,
  VehiclePosition,
} from '../lib/contract';
import type { ConnectionInfo } from '../lib/stream';

export const SPEED_HISTORY_WINDOWS = 40;
export const SUMMARY_HISTORY_POINTS = 180;
export const THROUGHPUT_POINTS = 90;
export const ALERTS_KEPT = 60;

export interface SpeedSample {
  t: number;
  v: number | null;
}

export interface SummarySample {
  t: number;
  avg_speed_kph: number | null;
  vehicles: number;
  congested_km: number;
}

export interface Snapshot {
  network: RoadNetwork;
  states: SegmentState[];
  summary: NetworkSummary | null;
  alerts: CongestionAlert[];
  incidents: Incident[];
  predictions: PredictionSet | null;
  system: SystemStatus | null;
  throughput: ThroughputPoint[];
}

export interface LiveData {
  network: RoadNetwork | null;
  segIndex: Record<string, RoadSegment>;
  states: Record<string, SegmentState>;
  speedHistory: Record<string, SpeedSample[]>;
  windowEnd: string | null;
  summary: NetworkSummary | null;
  summaryHistory: SummarySample[];
  vehicles: VehiclePosition[];
  vehiclesAt: number | null;
  alerts: CongestionAlert[];
  incidents: Record<string, Incident>;
  predictions: PredictionSet | null;
  system: SystemStatus | null;
  throughput: ThroughputPoint[];
  connection: ConnectionInfo & {
    since: number | null;
    lastEventAt: number | null;
    reconnects: number;
    eventsReceived: number;
  };
  bootstrap: { status: 'idle' | 'loading' | 'ready' | 'error'; error: string | null };
}

export const initialLiveData: LiveData = {
  network: null,
  segIndex: {},
  states: {},
  speedHistory: {},
  windowEnd: null,
  summary: null,
  summaryHistory: [],
  vehicles: [],
  vehiclesAt: null,
  alerts: [],
  incidents: {},
  predictions: null,
  system: null,
  throughput: [],
  connection: {
    state: 'idle',
    attempt: 0,
    nextRetryMs: null,
    lastEventId: null,
    error: null,
    since: null,
    lastEventAt: null,
    reconnects: 0,
    eventsReceived: 0,
  },
  bootstrap: { status: 'idle', error: null },
};

const push = <T,>(list: T[], item: T, max: number): T[] => {
  const next = list.length >= max ? list.slice(list.length - max + 1) : list.slice();
  next.push(item);
  return next;
};

function appendSpeeds(history: Record<string, SpeedSample[]>, states: SegmentState[]): Record<string, SpeedSample[]> {
  const next = { ...history };
  for (const s of states) {
    const t = new Date(s.window_end).getTime();
    const prev = next[s.segment_id] ?? [];
    if (prev.length && prev[prev.length - 1].t >= t) continue; // duplicate or older window
    next[s.segment_id] = push(prev, { t, v: s.avg_speed_kph }, SPEED_HISTORY_WINDOWS);
  }
  return next;
}

function summarySample(s: NetworkSummary): SummarySample {
  return {
    t: new Date(s.as_of).getTime(),
    avg_speed_kph: s.avg_speed_kph,
    vehicles: s.vehicles_active,
    congested_km: s.congested_km,
  };
}

/** Applies a REST snapshot. Pure, so it is unit-tested. */
export function applySnapshot(data: LiveData, snap: Snapshot): LiveData {
  const segIndex: Record<string, RoadSegment> = {};
  for (const seg of snap.network.segments) segIndex[seg.id] = seg;
  const states: Record<string, SegmentState> = {};
  for (const s of snap.states) states[s.segment_id] = s;
  const incidents: Record<string, Incident> = {};
  for (const inc of snap.incidents) incidents[inc.incident_id] = inc;
  const windowEnd = snap.states.reduce<string | null>((m, s) => (!m || s.window_end > m ? s.window_end : m), null);
  return {
    ...data,
    network: snap.network,
    segIndex,
    states,
    windowEnd,
    speedHistory: appendSpeeds(data.speedHistory, snap.states),
    summary: snap.summary,
    summaryHistory: snap.summary ? push(data.summaryHistory, summarySample(snap.summary), SUMMARY_HISTORY_POINTS) : data.summaryHistory,
    alerts: [...snap.alerts].sort((a, b) => b.raised_at.localeCompare(a.raised_at)).slice(0, ALERTS_KEPT),
    incidents,
    predictions: snap.predictions,
    system: snap.system,
    throughput: snap.throughput.slice(-THROUGHPUT_POINTS),
  };
}

/** Applies one stream event. Pure, so it is unit-tested. */
export function applyEvent<K extends StreamEventType>(data: LiveData, type: K, payload: StreamEventMap[K]): LiveData {
  switch (type) {
    case 'segments': {
      const p = payload as StreamEventMap['segments'];
      if (data.windowEnd && p.window_end < data.windowEnd) return data; // out-of-order window
      const states = { ...data.states };
      for (const s of p.states) states[s.segment_id] = s;
      return { ...data, states, windowEnd: p.window_end, speedHistory: appendSpeeds(data.speedHistory, p.states) };
    }
    case 'vehicles': {
      const p = payload as StreamEventMap['vehicles'];
      return { ...data, vehicles: p.vehicles, vehiclesAt: new Date(p.ts).getTime() };
    }
    case 'summary': {
      const p = payload as NetworkSummary;
      return { ...data, summary: p, summaryHistory: push(data.summaryHistory, summarySample(p), SUMMARY_HISTORY_POINTS) };
    }
    case 'alert': {
      const p = payload as CongestionAlert;
      if (data.alerts.some((a) => a.alert_id === p.alert_id)) return data;
      return { ...data, alerts: [p, ...data.alerts].slice(0, ALERTS_KEPT) };
    }
    case 'incident': {
      const p = payload as Incident;
      const prev = data.incidents[p.incident_id];
      if (prev && prev.updated_at > p.updated_at) return data; // stale update
      return { ...data, incidents: { ...data.incidents, [p.incident_id]: p } };
    }
    case 'predictions':
      return { ...data, predictions: payload as PredictionSet };
    case 'system': {
      const p = payload as SystemStatus;
      const point: ThroughputPoint = {
        ts: p.as_of,
        in_per_s: p.throughput.in_per_s,
        out_per_s: p.throughput.out_per_s,
        p95_ms: p.latency_ms.p95,
      };
      const last = data.throughput[data.throughput.length - 1];
      const throughput = last && last.ts >= point.ts ? data.throughput : push(data.throughput, point, THROUGHPUT_POINTS);
      return { ...data, system: p, throughput };
    }
    case 'heartbeat':
    default:
      return data;
  }
}

interface LiveActions {
  setSnapshot: (snap: Snapshot) => void;
  setBootstrap: (status: LiveData['bootstrap']['status'], error?: string | null) => void;
  receive: <K extends StreamEventType>(type: K, payload: StreamEventMap[K], id: string | null) => void;
  setConnection: (info: ConnectionInfo) => void;
  reset: () => void;
  /** Set by the console: load the network and open the stream. The landing never needs the whole network. */
  wanted: boolean;
  want: () => void;
}

export const useLive = create<LiveData & LiveActions>()((set) => ({
  ...initialLiveData,
  setSnapshot: (snap) => set((d) => ({ ...applySnapshot(d, snap), bootstrap: { status: 'ready', error: null } })),
  setBootstrap: (status, error = null) => set({ bootstrap: { status, error } }),
  receive: (type, payload, id) =>
    set((d) => {
      const next = applyEvent(d, type, payload);
      return {
        ...next,
        connection: {
          ...d.connection,
          lastEventAt: Date.now(),
          lastEventId: id ?? d.connection.lastEventId,
          eventsReceived: d.connection.eventsReceived + 1,
        },
      };
    }),
  setConnection: (info) =>
    set((d) => {
      const wasLive = d.connection.state === 'live';
      const nowLive = info.state === 'live';
      return {
        connection: {
          ...d.connection,
          ...info,
          lastEventId: info.lastEventId ?? d.connection.lastEventId,
          since: nowLive ? (wasLive ? d.connection.since : Date.now()) : null,
          // counts drops: each time a live stream falls back to retrying
          reconnects: d.connection.reconnects + (wasLive && (info.state === 'reconnecting' || info.state === 'offline') ? 1 : 0),
        },
      };
    }),
  reset: () => set({ ...initialLiveData }),
  wanted: false,
  want: () => set({ wanted: true }),
}));
