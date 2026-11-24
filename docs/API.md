# Arterial API, v1

Base path `/api/v1`. JSON everywhere. Timestamps are ISO 8601 UTC, speeds km/h, distances metres,
coordinates `[lng, lat]`. TypeScript shapes for every response are in
[`frontend/src/lib/contract.ts`](../frontend/src/lib/contract.ts); this page and that file must
agree. The server is built during the build window (28-29 Nov 2026 IST).

All traffic data comes from **simulated** telemetry.

## Errors

Every non-2xx response:

```json
{ "error": { "code": "segment_not_found", "message": "No segment ORR-09.", "request_id": "c1f3…" } }
```

| Status | Codes |
|---|---|
| 400 | `invalid_parameter`, `same_origin_destination` |
| 404 | `segment_not_found`, `incident_not_found`, `node_not_found` |
| 409 | `no_route` (origin cannot reach destination) |
| 429 | `rate_limited` (route requests, 30 a minute per client) |
| 503 | `pipeline_unavailable` (no segment window received for 2 minutes), `model_unavailable` |

## Endpoints

| Method | Path | Returns | Notes |
|---|---|---|---|
| GET | `/health` | `{ "status": "ok" }` | Liveness only |
| GET | `/network` | `RoadNetwork` | Nodes and segments with geometry |
| GET | `/traffic/segments` | `{ as_of, window_s, states: SegmentState[] }` | Latest closed window per segment |
| GET | `/traffic/segments/{id}` | `SegmentDetail` | `?minutes=60` of window history |
| GET | `/traffic/summary` | `NetworkSummary` | |
| GET | `/traffic/history` | `TrafficHistory` | `?minutes=60` (max 1440) |
| GET | `/alerts` | `{ alerts: CongestionAlert[] }` | `?status=active\|all&limit=50` |
| GET | `/predictions` | `PredictionSet` | `?horizon=5\|10\|15` filters `predictions` |
| GET | `/predictions/model` | `ModelInfo` | Evaluation per horizon beside persistence |
| GET | `/incidents` | `{ incidents: Incident[] }` | `?status=active\|resolved\|all&severity=&since=&limit=` |
| GET | `/incidents/{id}` | `Incident` | Includes timeline |
| POST | `/routes` | `RouteResponse` | Body `RouteRequest`: `{ "origin": "N04", "destination": "N10" }` |
| GET | `/analytics/overview` | `AnalyticsOverview` | `?days=7` |
| GET | `/system/status` | `SystemStatus` | |
| GET | `/system/throughput` | `{ points: ThroughputPoint[] }` | `?minutes=15`, 10 s resolution |
| GET | `/stream` | Server-Sent Events | See below |
| POST | `/sim/scenario` | `{ scenario, applied_at }` | Simulator only. Body `{ "scenario": "incident", "segment_id": "ORR-03" }`. Never touches real infrastructure. |

## Live stream

`GET /api/v1/stream` with `Accept: text/event-stream`.

```
id: 18342
event: segments
data: {"window_end":"2026-11-28T10:15:30Z","states":[ … SegmentState … ]}
```

| Event | Payload | Cadence |
|---|---|---|
| `segments` | `{ window_end, states: SegmentState[] }` | Every 30 s window close |
| `vehicles` | `{ ts, vehicles: VehiclePosition[] }` | Every 1 s, sampled to at most 600 vehicles |
| `summary` | `NetworkSummary` | Every 5 s |
| `alert` | `CongestionAlert` | When raised |
| `incident` | `Incident` | When detected, updated or resolved |
| `predictions` | `PredictionSet` | Every window close |
| `system` | `SystemStatus` | Every 2 s |
| `heartbeat` | `{ ts }` | Every 10 s with no other event |

Ids increase by one per event within a server process. On reconnect, the client sends the last id it
saw as the `Last-Event-ID` header or, when it opens a fresh connection itself, as the
`?last_event_id=` query parameter; the server accepts both and replays up to 2 minutes of missed
events. If the id is older than that, or the server
restarted, it sends `event: resync` and the client reloads its snapshots over REST.

The client treats 15 s without any event as a dead connection and reconnects with exponential
backoff (1 s, 2 s, 4 s … capped at 30 s, with jitter).
