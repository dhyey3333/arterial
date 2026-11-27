"""validate-telemetry: telemetry-raw -> telemetry-valid, or telemetry-rejected with a reason.

Rules from docs/EVENTS.md. Duplicates are caught by event_id for 10 minutes; a vehicle's lower
seq than its last marks the event out of order, which is kept and flagged, not rejected.
"""

from __future__ import annotations

import json
import math
from collections import OrderedDict
from datetime import datetime, timedelta, timezone

from pipeline.common import CONFIG, PIPELINE_VERSION, load_networks, now_iso, parse_ts, topic

V = CONFIG["validation"]
TYPES = {"car", "two_wheeler", "auto_rickshaw", "bus", "truck"}
REQUIRED = {"event_id": str, "vehicle_id": str, "vehicle_type": str, "ts": str, "region": str, "road_segment_id": str, "seq": int, "source": str}


class Validator:
    def __init__(self, networks: dict | None = None):
        self.networks = networks if networks is not None else load_networks()
        self.boxes = {}
        for rid, net in self.networks.items():
            w, s, e, n = net["region"]["bbox"]
            dlat = V["bbox_margin_m"] / 111_320
            dlng = dlat / max(math.cos(math.radians((s + n) / 2)), 0.1)
            self.boxes[rid] = (w - dlng, s - dlat, e + dlng, n + dlat)
        self.seen: OrderedDict[str, datetime] = OrderedDict()
        self.last_seq: dict[str, int] = {}
        self.out_valid, self.out_rejected = topic("telemetry-valid"), topic("telemetry-rejected")
        self.counts = {"valid": 0}

    def _reject(self, key, original, reason: str, detail: str):
        self.counts[reason] = self.counts.get(reason, 0) + 1
        body = dict(original) if isinstance(original, dict) else {"raw": original}
        body.update({"rejected_at": now_iso(), "reason": reason, "detail": detail})
        return [(self.out_rejected, key or "unknown", json.dumps(body, separators=(",", ":")))]

    def process(self, key, value: str, now: datetime | None = None):
        now = now or datetime.now(timezone.utc)
        try:
            ev = json.loads(value)
            if not isinstance(ev, dict):
                raise ValueError("not an object")
        except ValueError as e:
            return self._reject(key, value[:2000], "invalid_json", str(e)[:200])

        for f, typ in REQUIRED.items():
            if not isinstance(ev.get(f), typ) or isinstance(ev.get(f), bool):
                return self._reject(key, ev, "schema", f"{f} missing or not {typ.__name__}")
        if ev.get("schema") != "arterial.telemetry.v1":
            return self._reject(key, ev, "schema", f"schema is {ev.get('schema')!r}")
        if not ev["vehicle_id"].startswith("SIM-"):
            return self._reject(key, ev, "schema", "vehicle_id must start with SIM-")
        if ev["vehicle_type"] not in TYPES:
            return self._reject(key, ev, "schema", f"vehicle_type {ev['vehicle_type']!r}")
        if ev["source"] != "simulated":
            return self._reject(key, ev, "schema", "source must be simulated")
        lat, lng = ev.get("lat"), ev.get("lng")
        if lat is None or lng is None:
            return self._reject(key, ev, "missing_gps", "lat is null" if lat is None else "lng is null")
        if not all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in (lat, lng)):
            return self._reject(key, ev, "schema", "lat and lng must be numbers")
        speed = ev.get("speed_kph")
        if not isinstance(speed, (int, float)) or isinstance(speed, bool) or not 0 <= speed <= V["max_speed_kph"]:
            return self._reject(key, ev, "speed_range", f"speed_kph {speed!r} outside 0-{V['max_speed_kph']}")
        heading = ev.get("heading_deg")
        if heading is not None and (not isinstance(heading, (int, float)) or not 0 <= heading <= 360):
            return self._reject(key, ev, "schema", f"heading_deg {heading!r}")
        region = ev["region"]
        if region not in self.networks:
            return self._reject(key, ev, "unknown_region", f"region {region!r} is not configured")
        w, s, e, n = self.boxes[region]
        if not (w <= lng <= e and s <= lat <= n):
            return self._reject(key, ev, "out_of_bounds", f"({lat}, {lng}) outside {region}")
        if ev["road_segment_id"] not in self.networks[region]["by_id"]:
            return self._reject(key, ev, "unknown_segment", f"{ev['road_segment_id']} is not in {region}")
        try:
            ts = parse_ts(ev["ts"])
            if ts.tzinfo is None:
                raise ValueError("no time zone")
        except ValueError as e:
            return self._reject(key, ev, "schema", f"ts: {e}")
        if (ts - now).total_seconds() > V["max_future_s"]:
            return self._reject(key, ev, "future_timestamp", f"ts is {(ts - now).total_seconds():.0f} s ahead")

        # duplicates within the TTL
        horizon = now - timedelta(seconds=V["duplicate_ttl_s"])
        while self.seen and next(iter(self.seen.values())) < horizon:
            self.seen.popitem(last=False)
        if ev["event_id"] in self.seen:
            return self._reject(key, ev, "duplicate", f"event_id {ev['event_id']} seen before")
        self.seen[ev["event_id"]] = now

        last = self.last_seq.get(ev["vehicle_id"])
        ev["out_of_order"] = last is not None and ev["seq"] < last
        self.last_seq[ev["vehicle_id"]] = max(ev["seq"], last or 0)
        ev["validated_at"] = now_iso()
        ev["pipeline_version"] = PIPELINE_VERSION
        self.counts["valid"] += 1
        return [(self.out_valid, ev["road_segment_id"], json.dumps(ev, separators=(",", ":")))]


def main() -> None:
    from pipeline.common import load_env, run

    load_env()
    v = Validator()
    run("validate-telemetry", [topic("telemetry-raw")], v.process)


if __name__ == "__main__":
    main()
