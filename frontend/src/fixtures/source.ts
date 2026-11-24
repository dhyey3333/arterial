/**
 * DESIGN FIXTURE SOURCE. Plays the hand-written fixture scenes on a loop so the
 * interface, its transitions and its stream handling can be built and tested
 * before the backend exists. Development and tests only; the app shows a
 * banner whenever this source is active.
 */
import { ApiError, type DataSource, type StreamHandlers } from '../lib/api';
import type { Incident, SegmentState, SegmentDetail, StreamEventMap, StreamEventType } from '../lib/contract';
import {
  MODEL,
  SCENE_ORDER,
  WINDOW_S,
  alertsBetween,
  analytics,
  baseIncidents,
  blockageIncident,
  createFleet,
  fixtureRoute,
  mulberry32,
  network,
  sceneStates,
  scenePredictions,
  speedDropIncident,
  stepFleet,
  summaryOf,
  systemStatus,
  throughputHistory,
  trafficHistory,
} from './data';

const SCENE_MS = 8000;

export function createFixtureSource(): DataSource {
  const rand = mulberry32(7);
  const start = new Date();
  let step = 0;
  let scene: number = SCENE_ORDER[0];
  let windowEnd = new Date(Math.floor(start.getTime() / 30_000) * 30_000);
  let states: SegmentState[] = sceneStates(scene, null, windowEnd);
  const incidents = new Map<string, Incident>(baseIncidents(start).map((i) => [i.incident_id, i]));
  const alertCounter = { n: 120 };
  let alerts = alertsBetween(sceneStates(0, null, windowEnd), sceneStates(1, 0, windowEnd), new Date(start.getTime() - 9 * 60_000), alertCounter);
  const fleet = createFleet();
  let vehicles = stepFleet(fleet, Object.fromEntries(states.map((s) => [s.segment_id, s])), 0, start);
  let eventId = 0;

  const stateMap = () => Object.fromEntries(states.map((s) => [s.segment_id, s]));
  const activeCount = () => [...incidents.values()].filter((i) => i.status === 'active').length;
  const nextScene = () => SCENE_ORDER[(step + 1) % SCENE_ORDER.length];

  function routeGet(path: string): unknown {
    const url = new URL(path, 'http://fixture');
    const p = url.pathname;
    const now = new Date();
    if (p === '/network') return network;
    if (p === '/traffic/segments') return { as_of: now.toISOString(), window_s: WINDOW_S, states };
    if (p === '/traffic/summary') return summaryOf(states, now, 180, activeCount());
    if (p === '/traffic/history') return trafficHistory(now, Number(url.searchParams.get('minutes') ?? 60));
    if (p.startsWith('/traffic/segments/')) {
      const id = decodeURIComponent(p.split('/').pop()!);
      const segment = network.segments.find((s) => s.id === id);
      if (!segment) throw new ApiError(404, 'segment_not_found', `No segment ${id}.`);
      const current = states.find((s) => s.segment_id === id) ?? null;
      const history: SegmentState[] = [];
      if (current) {
        for (let i = 39; i >= 0; i--) {
          const end = new Date(windowEnd.getTime() - i * 30_000);
          const drift = Math.sin(i / 6) * 2.2 + i * 0.12;
          const v = Math.max(3, (current.avg_speed_kph ?? segment.free_flow_kph) + drift);
          history.push({ ...current, window_end: end.toISOString(), window_start: new Date(end.getTime() - 30_000).toISOString(), avg_speed_kph: Math.round(v * 10) / 10 });
        }
      }
      const detail: SegmentDetail = {
        segment,
        state: current,
        history,
        predictions: scenePredictions(scene, nextScene(), windowEnd).predictions.filter((x) => x.segment_id === id),
        incidents: [...incidents.values()].filter((i) => i.segment_id === id || i.affected_segments.includes(id)),
      };
      return detail;
    }
    if (p === '/alerts') return { alerts };
    if (p === '/incidents') return { incidents: [...incidents.values()] };
    if (p.startsWith('/incidents/')) {
      const id = decodeURIComponent(p.split('/').pop()!);
      const inc = incidents.get(id);
      if (!inc) throw new ApiError(404, 'incident_not_found', `No incident ${id}.`);
      return inc;
    }
    if (p === '/predictions') return scenePredictions(scene, nextScene(), windowEnd);
    if (p === '/predictions/model') return MODEL;
    if (p === '/analytics/overview') return analytics(Number(url.searchParams.get('days') ?? 7), now);
    if (p === '/system/status') return systemStatus(now, rand, vehicles[0] ?? null);
    if (p === '/system/throughput') return { points: throughputHistory(now, rand) };
    throw new ApiError(404, 'not_found', `The design fixtures have nothing at ${p}.`);
  }

  const delay = <T,>(value: () => T, ms = 160): Promise<T> =>
    new Promise((resolve, reject) =>
      setTimeout(() => {
        try {
          resolve(value());
        } catch (err) {
          reject(err);
        }
      }, ms),
    );

  return {
    kind: 'fixtures',
    label: 'Design fixtures',
    get: <T,>(path: string) => delay(() => routeGet(path) as T),
    post: <T,>(path: string, body: unknown) =>
      delay(() => {
        if (path === '/routes') {
          const { origin, destination } = body as { origin: string; destination: string };
          if (origin === destination) throw new ApiError(400, 'same_origin_destination', 'Pick two different junctions.');
          const r = fixtureRoute(origin, destination, stateMap(), new Date());
          if (!r) throw new ApiError(409, 'no_route', 'The design fixtures only hold one route: Silk Board Junction to Bellandur. The real engine routes any pair.');
          return r as T;
        }
        throw new ApiError(404, 'not_found', `The design fixtures have nothing at ${path}.`);
      }, 420),
    connect(h: StreamHandlers) {
      const timers: ReturnType<typeof setInterval>[] = [];
      const emit = <K extends StreamEventType>(type: K, data: StreamEventMap[K]) => {
        eventId += 1;
        h.onEvent(type, data, String(eventId));
      };
      h.onInfo({ state: 'connecting', attempt: 0, nextRetryMs: null, lastEventId: null, error: null });
      const opened = setTimeout(() => h.onInfo({ state: 'live', attempt: 0, nextRetryMs: null, lastEventId: null, error: null }), 350);

      let last = Date.now();
      timers.push(
        setInterval(() => {
          const now = Date.now();
          const dt = Math.min(3, (now - last) / 1000);
          last = now;
          vehicles = stepFleet(fleet, stateMap(), dt, new Date(now));
          emit('vehicles', { ts: new Date(now).toISOString(), vehicles });
        }, 1000),
      );
      timers.push(setInterval(() => emit('summary', summaryOf(states, new Date(), 170 + Math.round(rand() * 25), activeCount())), 5000));
      timers.push(setInterval(() => emit('system', systemStatus(new Date(), rand, vehicles[0] ?? null)), 2000));
      timers.push(
        setInterval(() => {
          const prevScene = scene;
          step = (step + 1) % SCENE_ORDER.length;
          scene = SCENE_ORDER[step];
          windowEnd = new Date(windowEnd.getTime() + WINDOW_S * 1000);
          const prevStates = states;
          states = sceneStates(scene, prevScene, windowEnd);
          emit('segments', { window_end: windowEnd.toISOString(), states });
          emit('predictions', scenePredictions(scene, nextScene(), windowEnd));
          const now = new Date();
          for (const a of alertsBetween(prevStates, states, now, alertCounter)) {
            alerts = [a, ...alerts].slice(0, 60);
            emit('alert', a);
          }
          if (scene === 1 && prevScene === 0) {
            const inc = speedDropIncident(now);
            incidents.set(inc.incident_id, inc);
            emit('incident', inc);
          }
          if (scene === 2 && prevScene === 1) {
            const inc = blockageIncident(now);
            incidents.set(inc.incident_id, inc);
            emit('incident', inc);
          }
          if (scene === 0 && prevScene === 1) {
            for (const inc of incidents.values()) {
              if (inc.status !== 'active') continue;
              const resolved: Incident = {
                ...inc,
                status: 'resolved',
                resolved_at: now.toISOString(),
                updated_at: now.toISOString(),
                timeline: [...inc.timeline, { ts: now.toISOString(), kind: 'resolved', note: 'Four normal windows in a row' }],
              };
              incidents.set(inc.incident_id, resolved);
              emit('incident', resolved);
            }
          }
        }, SCENE_MS),
      );
      return () => {
        clearTimeout(opened);
        timers.forEach(clearInterval);
      };
    },
  };
}
