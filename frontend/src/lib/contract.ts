/**
 * Arterial API contract, v1.
 *
 * The single source of truth for the shapes the frontend reads. It mirrors
 * docs/API.md and docs/EVENTS.md. The backend that serves these shapes is
 * built during the Configure 2026 build window (28-29 Nov 2026 IST); this file
 * was written before it, as frontend preparation, and is disclosed as such in
 * docs/COMPLIANCE.md.
 *
 * Conventions: timestamps are ISO 8601 strings in UTC, speeds in km/h,
 * distances in metres, coordinates as [lng, lat]. Every traffic value comes
 * from simulated telemetry, never from real vehicles.
 */

export type CongestionLevel = 'free' | 'moderate' | 'heavy' | 'severe';
export type SegmentLevel = CongestionLevel | 'no_data';
export type Trend = 'improving' | 'stable' | 'worsening';
export type VehicleType = 'car' | 'two_wheeler' | 'auto_rickshaw' | 'bus' | 'truck';
export type RoadClass = 'motorway' | 'trunk' | 'primary' | 'secondary' | 'tertiary';
export type LngLat = [number, number];

export const LEVELS: CongestionLevel[] = ['free', 'moderate', 'heavy', 'severe'];

// ---------- Road network ----------

/**
 * The region a network covers: the national tier (all of India's expressways and national
 * highways) or one city in street-level detail. One API process serves one region
 * (docs/ARCHITECTURE.md, section 2.1).
 */
export interface RegionInfo {
  /** Short id that prefixes every node and segment id, e.g. "in" or "blr". */
  id: string;
  kind: 'national' | 'city';
  name: string;
  /** [west, south, east, north] of the network. */
  bbox: [number, number, number, number];
  timezone: string;
  /** Share of all traffic the simulated vehicles stand for: 1 in a city, 0.05 on the national tier. */
  probe_share: number;
}

export interface RoadNode {
  id: string;
  name: string;
  lng: number;
  lat: number;
}

export interface RoadSegment {
  id: string;
  name: string;
  road_class: RoadClass;
  from_node: string;
  to_node: string;
  length_m: number;
  speed_limit_kph: number;
  /** Baseline speed with no congestion, from the segment's history or its class default. */
  free_flow_kph: number;
  lanes: number;
  geometry: LngLat[];
}

export interface RoadNetwork {
  region: RegionInfo;
  /** Where the road shapes came from, shown in the map attribution. */
  source: string;
  nodes: RoadNode[];
  segments: RoadSegment[];
}

/**
 * One match from GET /places, always tied to a junction so it is ready for a route request.
 * A junction matches by its own name or a road meeting there; on the national tier a town or
 * village matches by name and is snapped to its nearest highway junction.
 */
export interface PlaceResult {
  kind: 'junction' | 'place';
  name: string;
  /** For a place, its district or state when OSM has it. */
  context: string | null;
  lng: number;
  lat: number;
  node_id: string;
  /** Names of the roads that meet at that junction. */
  roads: string[];
  /** From the place to the junction it was snapped to; 0 for a junction. */
  distance_m: number;
}

export interface PlaceSearch {
  query: string;
  region: string;
  places: PlaceResult[];
}

// ---------- Live segment state (one closed window per segment) ----------

export interface SegmentState {
  segment_id: string;
  window_start: string;
  window_end: string;
  /** Space-mean speed (harmonic mean of spot speeds). Null when no vehicle reported. */
  avg_speed_kph: number | null;
  free_flow_kph: number;
  /** avg_speed / free_flow, 0..1+. */
  speed_ratio: number | null;
  speed_reduction_pct: number | null;
  /** Distinct vehicles seen in the window. */
  vehicle_count: number;
  density_veh_per_km: number;
  /** q = k x v */
  flow_veh_per_h: number;
  level: SegmentLevel;
  /** 0..100, from the speed ratio and density; see docs/ARCHITECTURE.md. */
  severity: number;
  trend: Trend;
  trend_kph_per_min: number;
  /** Plain-language reason for the level, built by the classifier. */
  reason: string;
}

export interface NetworkSummary {
  as_of: string;
  vehicles_active: number;
  avg_speed_kph: number | null;
  congested_km: number;
  network_km: number;
  segments_by_level: Record<SegmentLevel, number>;
  events_per_s: number;
  active_incidents: number;
}

export interface TrafficHistoryPoint {
  ts: string;
  avg_speed_kph: number | null;
  vehicles: number;
  congested_km: number;
  by_level: Record<SegmentLevel, number>;
}

export interface TrafficHistory {
  minutes: number;
  points: TrafficHistoryPoint[];
  /** The same clock window one simulated day earlier, for comparison. Empty until a day of history exists. */
  comparison: { label: string; points: TrafficHistoryPoint[] };
}

export interface SegmentDetail {
  segment: RoadSegment;
  state: SegmentState | null;
  history: SegmentState[];
  predictions: Prediction[];
  incidents: Incident[];
}

// ---------- Vehicles ----------

export interface VehiclePosition {
  vehicle_id: string;
  vehicle_type: VehicleType;
  lng: number;
  lat: number;
  speed_kph: number;
  heading_deg: number;
  segment_id: string;
  ts: string;
}

// ---------- Alerts ----------

export type AlertKind = 'emerging' | 'escalated' | 'sustained' | 'cleared';

export interface CongestionAlert {
  alert_id: string;
  segment_id: string;
  kind: AlertKind;
  level_from: SegmentLevel;
  level_to: SegmentLevel;
  raised_at: string;
  message: string;
}

// ---------- Predictions ----------

export interface Prediction {
  segment_id: string;
  made_at: string;
  horizon_min: number;
  target_time: string;
  current_speed_kph: number | null;
  predicted_speed_kph: number;
  expected_change_kph: number;
  /** Interval from held-out residuals for this horizon (about 80%). */
  interval_kph: [number, number];
  predicted_level: CongestionLevel;
  /** 0..1: share of the interval that falls in heavy or severe. Not a calibrated probability. */
  risk: number;
  /** Features that pushed the forecast, in plain language. */
  drivers: string[];
}

export interface ModelEvaluation {
  horizon_min: number;
  mae_kph: number;
  rmse_kph: number;
  /** Persistence baseline: "the speed stays what it is now". */
  baseline_mae_kph: number;
  baseline_rmse_kph: number;
  n: number;
}

export interface ModelInfo {
  name: string;
  version: string;
  /** Id of the region the model was trained and evaluated on. */
  region: string;
  kind: 'rule_baseline' | 'trained';
  description: string;
  trained_at: string | null;
  training_windows: number;
  evaluated_at: string | null;
  evaluation: ModelEvaluation[];
}

export interface PredictionSet {
  made_at: string;
  horizons: number[];
  model: ModelInfo;
  /** All horizons for all segments; filter by horizon_min. */
  predictions: Prediction[];
}

// ---------- Incidents ----------

export type IncidentType =
  | 'sudden_speed_drop'
  | 'abnormal_accumulation'
  | 'flow_breakdown'
  | 'possible_blockage'
  | 'unusual_density';

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface IncidentEvidence {
  metric: string;
  label: string;
  baseline: number;
  observed: number;
  unit: string;
}

export interface IncidentTimelineEntry {
  ts: string;
  kind: 'detected' | 'escalated' | 'updated' | 'resolved';
  note: string;
}

export interface Incident {
  incident_id: string;
  segment_id: string;
  type: IncidentType;
  severity: IncidentSeverity;
  status: 'active' | 'resolved';
  detected_at: string;
  updated_at: string;
  resolved_at: string | null;
  reason: string;
  evidence: IncidentEvidence[];
  affected_segments: string[];
  conditions: Pick<
    SegmentState,
    'avg_speed_kph' | 'vehicle_count' | 'density_veh_per_km' | 'flow_veh_per_h' | 'level'
  >;
  timeline: IncidentTimelineEntry[];
  /** Always true: these are anomalies in simulated data, not verified accidents. */
  simulated: true;
}

// ---------- Routes ----------

export interface RouteRequest {
  origin: string;
  destination: string;
}

export interface RouteOption {
  node_ids: string[];
  segment_ids: string[];
  distance_m: number;
  eta_s: number;
  free_flow_eta_s: number;
  delay_s: number;
  /** Metres of the route at each current level. */
  exposure_m: Record<SegmentLevel, number>;
  geometry: LngLat[];
}

export interface RouteResponse {
  as_of: string;
  origin: string;
  destination: string;
  algorithm: 'a_star' | 'dijkstra';
  /** Fastest path under current conditions. */
  recommended: RouteOption;
  /** Next-best path that shares under 60% of its length with the recommended one, if any. */
  alternative: RouteOption | null;
  /** Fastest path if every road ran at free-flow speed, timed at current conditions. */
  free_flow_fastest: RouteOption;
  time_saved_s: number;
  explanation: string[];
}

// ---------- Analytics ----------

export interface HourlyPoint {
  hour: number;
  avg_speed_kph: number | null;
  congested_share: number;
  vehicles: number;
}

export interface SegmentPerformance {
  segment_id: string;
  avg_speed_kph: number | null;
  /** 15th percentile of window speeds: the "bad day" speed. */
  p15_speed_kph: number | null;
  congested_minutes: number;
  congestion_episodes: number;
  incidents: number;
  /** Planning time index: free-flow travel time / p15-speed travel time, 0..1. Higher is more reliable. */
  reliability: number | null;
}

export interface FlowPoint {
  ts: string;
  flow_veh_per_h: number;
  avg_speed_kph: number | null;
  vehicles: number;
}

export interface AnalyticsOverview {
  from: string;
  to: string;
  /** Days of simulated history behind these numbers. */
  simulated_days: number;
  hourly: HourlyPoint[];
  peak_hours: number[];
  heat: { segment_id: string; hour: number; congested_share: number }[];
  segments: SegmentPerformance[];
  flow: FlowPoint[];
}

// ---------- System ----------

export type HealthStatus = 'ok' | 'degraded' | 'down' | 'unknown';

export interface StageStatus {
  id: string;
  name: string;
  kind: 'producer' | 'topic' | 'connector' | 'transform' | 'utility' | 'consumer' | 'api';
  runs_on: 'condense' | 'kafka' | 'local';
  status: HealthStatus;
  events_in_per_s: number;
  events_out_per_s: number;
  last_event_at: string | null;
  errors_total: number;
  /** Ids of the stages this one feeds, so the app can draw the pipeline as configured. */
  downstream: string[];
}

export interface ConsumerStatus {
  group: string;
  topic: string;
  lag: number;
  status: HealthStatus;
  last_commit_at: string | null;
}

export interface SystemStatus {
  as_of: string;
  kafka: { connected: boolean; bootstrap_host: string | null; last_error: string | null; reconnects: number };
  stages: StageStatus[];
  consumers: ConsumerStatus[];
  throughput: { in_per_s: number; out_per_s: number };
  /** Event time to API ingest, over the last minute. */
  latency_ms: { p50: number; p95: number; max: number };
  last_event: { event_id: string; vehicle_id: string; segment_id: string; ts: string; processed_at: string } | null;
  errors: { validation_rejected: number; duplicates_dropped: number; late_events: number; consumer_errors: number };
  simulation: { running: boolean; scenario: string; seed: number; vehicles: number; target_rate: number };
}

export interface ThroughputPoint {
  ts: string;
  in_per_s: number;
  out_per_s: number;
  p95_ms: number;
}

// ---------- Errors ----------

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; request_id?: string };
}

// ---------- Live stream (Server-Sent Events on GET /api/v1/stream) ----------

export interface StreamEventMap {
  segments: { window_end: string; states: SegmentState[] };
  vehicles: { ts: string; vehicles: VehiclePosition[] };
  summary: NetworkSummary;
  alert: CongestionAlert;
  incident: Incident;
  predictions: PredictionSet;
  system: SystemStatus;
  heartbeat: { ts: string };
}

export type StreamEventType = keyof StreamEventMap;

export const STREAM_EVENT_TYPES: StreamEventType[] = [
  'segments',
  'vehicles',
  'summary',
  'alert',
  'incident',
  'predictions',
  'system',
  'heartbeat',
];
