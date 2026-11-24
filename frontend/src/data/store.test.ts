import { describe, expect, it } from 'vitest';
import type { CongestionAlert, Incident, SegmentState, SystemStatus } from '../lib/contract';
import { ALERTS_KEPT, SPEED_HISTORY_WINDOWS, applyEvent, applySnapshot, initialLiveData } from './store';

const state = (id: string, end: string, v: number | null = 30): SegmentState => ({
  segment_id: id,
  window_start: end,
  window_end: end,
  avg_speed_kph: v,
  free_flow_kph: 40,
  speed_ratio: v === null ? null : v / 40,
  speed_reduction_pct: v === null ? null : 100 - (v / 40) * 100,
  vehicle_count: 5,
  density_veh_per_km: 10,
  flow_veh_per_h: 300,
  level: 'free',
  severity: 10,
  trend: 'stable',
  trend_kph_per_min: 0,
  reason: 'test',
});

const alert = (id: string, at: string): CongestionAlert => ({
  alert_id: id,
  segment_id: 'S1',
  kind: 'emerging',
  level_from: 'free',
  level_to: 'heavy',
  raised_at: at,
  message: 'm',
});

const incident = (updated: string, severity: Incident['severity'] = 'high'): Incident => ({
  incident_id: 'INC-1',
  segment_id: 'S1',
  type: 'sudden_speed_drop',
  severity,
  status: 'active',
  detected_at: '2026-11-28T10:00:00Z',
  updated_at: updated,
  resolved_at: null,
  reason: 'r',
  evidence: [],
  affected_segments: ['S1'],
  conditions: { avg_speed_kph: 10, vehicle_count: 5, density_veh_per_km: 20, flow_veh_per_h: 200, level: 'heavy' },
  timeline: [],
  simulated: true,
});

describe('applyEvent: segments', () => {
  it('updates states and appends speed history', () => {
    const d = applyEvent(initialLiveData, 'segments', { window_end: '2026-11-28T10:00:30Z', states: [state('S1', '2026-11-28T10:00:30Z', 22)] });
    expect(d.states.S1.avg_speed_kph).toBe(22);
    expect(d.speedHistory.S1).toEqual([{ t: Date.parse('2026-11-28T10:00:30Z'), v: 22 }]);
    expect(d.windowEnd).toBe('2026-11-28T10:00:30Z');
  });

  it('ignores a window older than the newest one seen (out of order)', () => {
    const a = applyEvent(initialLiveData, 'segments', { window_end: '2026-11-28T10:01:00Z', states: [state('S1', '2026-11-28T10:01:00Z', 20)] });
    const b = applyEvent(a, 'segments', { window_end: '2026-11-28T10:00:30Z', states: [state('S1', '2026-11-28T10:00:30Z', 35)] });
    expect(b).toBe(a);
    expect(b.states.S1.avg_speed_kph).toBe(20);
  });

  it('does not duplicate a replayed window in history', () => {
    const ev = { window_end: '2026-11-28T10:00:30Z', states: [state('S1', '2026-11-28T10:00:30Z')] };
    const d = applyEvent(applyEvent(initialLiveData, 'segments', ev), 'segments', ev);
    expect(d.speedHistory.S1).toHaveLength(1);
  });

  it('keeps empty windows as null speed rather than guessing', () => {
    const d = applyEvent(initialLiveData, 'segments', { window_end: '2026-11-28T10:00:30Z', states: [state('S1', '2026-11-28T10:00:30Z', null)] });
    expect(d.speedHistory.S1[0].v).toBeNull();
  });

  it('caps history per segment', () => {
    let d = initialLiveData;
    for (let i = 0; i < SPEED_HISTORY_WINDOWS + 5; i++) {
      const end = new Date(Date.parse('2026-11-28T10:00:00Z') + i * 30_000).toISOString();
      d = applyEvent(d, 'segments', { window_end: end, states: [state('S1', end)] });
    }
    expect(d.speedHistory.S1).toHaveLength(SPEED_HISTORY_WINDOWS);
  });
});

describe('applyEvent: alerts and incidents', () => {
  it('puts new alerts first and drops duplicates', () => {
    let d = applyEvent(initialLiveData, 'alert', alert('A1', '2026-11-28T10:00:00Z'));
    d = applyEvent(d, 'alert', alert('A2', '2026-11-28T10:01:00Z'));
    d = applyEvent(d, 'alert', alert('A1', '2026-11-28T10:00:00Z'));
    expect(d.alerts.map((a) => a.alert_id)).toEqual(['A2', 'A1']);
  });

  it('keeps a bounded number of alerts', () => {
    let d = initialLiveData;
    for (let i = 0; i < ALERTS_KEPT + 10; i++) d = applyEvent(d, 'alert', alert(`A${i}`, `2026-11-28T10:${String(i % 60).padStart(2, '0')}:00Z`));
    expect(d.alerts).toHaveLength(ALERTS_KEPT);
  });

  it('applies newer incident updates and ignores stale ones', () => {
    let d = applyEvent(initialLiveData, 'incident', incident('2026-11-28T10:02:00Z', 'critical'));
    d = applyEvent(d, 'incident', incident('2026-11-28T10:01:00Z', 'low'));
    expect(d.incidents['INC-1'].severity).toBe('critical');
  });
});

describe('applyEvent: system', () => {
  const sys = (asOf: string): SystemStatus => ({
    as_of: asOf,
    kafka: { connected: true, bootstrap_host: 'h', last_error: null, reconnects: 0 },
    stages: [],
    consumers: [],
    throughput: { in_per_s: 100, out_per_s: 98 },
    latency_ms: { p50: 300, p95: 800, max: 1200 },
    last_event: null,
    errors: { validation_rejected: 0, duplicates_dropped: 0, late_events: 0, consumer_errors: 0 },
    simulation: { running: true, scenario: 'normal', seed: 1, vehicles: 10, target_rate: 100 },
  });

  it('records a throughput point per status and skips repeats', () => {
    let d = applyEvent(initialLiveData, 'system', sys('2026-11-28T10:00:00Z'));
    d = applyEvent(d, 'system', sys('2026-11-28T10:00:00Z'));
    d = applyEvent(d, 'system', sys('2026-11-28T10:00:02Z'));
    expect(d.throughput.map((p) => p.ts)).toEqual(['2026-11-28T10:00:00Z', '2026-11-28T10:00:02Z']);
    expect(d.system?.latency_ms.p95).toBe(800);
  });
});

describe('applySnapshot', () => {
  it('indexes segments, states and incidents and sorts alerts newest first', () => {
    const d = applySnapshot(initialLiveData, {
      network: {
        source: 'test',
        nodes: [],
        segments: [{ id: 'S1', name: 'Road', road_class: 'primary', from_node: 'A', to_node: 'B', length_m: 1000, speed_limit_kph: 50, free_flow_kph: 40, lanes: 2, geometry: [[0, 0], [1, 1]] }],
      },
      states: [state('S1', '2026-11-28T10:00:30Z')],
      summary: null,
      alerts: [alert('A1', '2026-11-28T10:00:00Z'), alert('A2', '2026-11-28T10:05:00Z')],
      incidents: [incident('2026-11-28T10:00:00Z')],
      predictions: null,
      system: null,
      throughput: [],
    });
    expect(d.segIndex.S1.name).toBe('Road');
    expect(d.states.S1).toBeDefined();
    expect(d.incidents['INC-1']).toBeDefined();
    expect(d.alerts[0].alert_id).toBe('A2');
    expect(d.windowEnd).toBe('2026-11-28T10:00:30Z');
  });
});
