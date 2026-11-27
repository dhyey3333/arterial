# Event schemas and topics

All topics live on the Condense-managed Kafka cluster and start with the team prefix the organizers
confirm with our login (shown here as `<prefix>`). Values are UTF-8 JSON. Keys are the road
segment id, so every event for a segment lands on one partition and stays in order for windowing.
Segment ids start with the region id (`blr-ORR-03`, `in-NH44-0123`), so the national tier and every
city share these topics without a collision (ARCHITECTURE.md, section 2.1).
Everything here is built during the build window.

## Topics

| Topic | Producer | Consumers | Key | Retention |
|---|---|---|---|---|
| `<prefix>.telemetry-raw` | simulator | `validate-telemetry` | segment id | per organizer limits |
| `<prefix>.telemetry-valid` | `validate-telemetry` | `segment-window` | segment id | |
| `<prefix>.telemetry-rejected` | `validate-telemetry` | API (counts, samples) | segment id or `unknown` | |
| `<prefix>.segment-metrics` | `segment-window` | Split, Alerts, `incident-detector`, `congestion-forecast`, API | segment id | |
| `<prefix>.congestion-alerts` | Split and Alerts utilities | API | segment id | |
| `<prefix>.incidents` | `incident-detector` | API | segment id | |
| `<prefix>.predictions` | `congestion-forecast` | API | segment id | |

Consumer groups: `<prefix>.api`, plus whatever group names Condense assigns its transforms
(**confirm**). Partition counts and retention follow the usage limits the organizers publish before
kickoff.

## `telemetry-raw`: vehicle telemetry, `arterial.telemetry.v1`

```json
{
  "schema": "arterial.telemetry.v1",
  "event_id": "7f6c1a52-3c1e-4b7a-9a43-1d0c5e2b9f10",
  "vehicle_id": "SIM-V-0042",
  "vehicle_type": "two_wheeler",
  "ts": "2026-11-28T10:15:30.120Z",
  "lat": 12.917240,
  "lng": 77.623010,
  "speed_kph": 23.4,
  "heading_deg": 87.0,
  "region": "blr",
  "road_segment_id": "blr-ORR-03",
  "seq": 1834,
  "source": "simulated",
  "sim_run_id": "run-2026-11-28-01"
}
```

| Field | Type | Rule enforced by `validate-telemetry` |
|---|---|---|
| `event_id` | UUID string | required; duplicates within 10 minutes dropped |
| `vehicle_id` | string | required, `SIM-` prefix |
| `vehicle_type` | enum | `car`, `two_wheeler`, `auto_rickshaw`, `bus`, `truck` |
| `ts` | ISO 8601 | required; more than 2 minutes in the future rejected |
| `lat`, `lng` | number | required; inside the region network's bounding box plus 1 km |
| `speed_kph` | number | 0 to 160 |
| `heading_deg` | number | 0 to 360 |
| `region` | string | a configured region id |
| `road_segment_id` | string | must exist in that region's network |
| `seq` | integer | per-vehicle counter; a lower `seq` than the last seen marks the event out-of-order (kept, flagged) |
| `source` | string | must be `"simulated"` |

The simulator deliberately injects a configurable share of bad events (missing GPS, duplicates,
out-of-order, impossible coordinates) so the validation path is exercised in the demo.

## `telemetry-rejected`

The original event (or the raw string if it was not JSON) plus:

```json
{ "rejected_at": "2026-11-28T10:15:30.410Z", "reason": "missing_gps", "detail": "lat is null" }
```

Reasons: `invalid_json`, `schema`, `missing_gps`, `out_of_bounds`, `speed_range`, `unknown_region`,
`unknown_segment`, `future_timestamp`, `duplicate`.

## `segment-metrics`, `arterial.segment-metrics.v1`

One message per segment per closed 30 s window: every field of `SegmentState` in
[`contract.ts`](../frontend/src/lib/contract.ts), plus:

```json
{ "schema": "arterial.segment-metrics.v1", "previous_level": "moderate", "level_changed": true, "late_events": 2, "low_sample": false }
```

## `congestion-alerts`, `incidents`, `predictions`

Same shapes as `CongestionAlert`, `Incident` and `Prediction` in `contract.ts`, each with a
`schema` field (`arterial.alert.v1`, `arterial.incident.v1`, `arterial.prediction.v1`). Predictions
are one message per segment per horizon; the API groups them into a `PredictionSet`.
