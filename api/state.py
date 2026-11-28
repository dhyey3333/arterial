"""Everything the API knows, built only from what arrives on the team's Kafka topics.

Nothing here invents a number: a segment with no window yet is `no_data`, a stage with no events is
`unknown`, and predictions, alerts and incidents stay empty until their stages publish them.
"""

from __future__ import annotations

import json
import math
import random
import threading
import time
from collections import Counter, OrderedDict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEVELS = ["free", "moderate", "heavy", "severe"]
STALE_S = 300  # a segment with no window for 5 minutes shows as no data


def iso(dt: datetime | None = None) -> str:
    return (dt or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


class Rate:
    """Events per second over a sliding window."""

    def __init__(self, window_s: float = 10):
        self.window = window_s
        self.marks: deque[tuple[float, int]] = deque()
        self.total = 0
        self.last_at: float | None = None

    def add(self, n: int = 1) -> None:
        now = time.time()
        self.total += n
        self.last_at = now
        if self.marks and now - self.marks[-1][0] < 0.5:
            t, c = self.marks[-1]
            self.marks[-1] = (t, c + n)
        else:
            self.marks.append((now, n))

    def per_s(self) -> float:
        now = time.time()
        while self.marks and now - self.marks[0][0] > self.window:
            self.marks.popleft()
        return round(sum(c for _, c in self.marks) / self.window, 1)


class State:
    def __init__(self, region: str):
        self.lock = threading.RLock()
        self.region_id = region
        net = json.loads((ROOT / "data" / "networks" / f"{region}.json").read_text(encoding="utf-8"))
        self.region = net["region"]
        self.source = net["source"]
        self.nodes = {n["id"]: n for n in net["nodes"]}
        self.segments = {s["id"]: s for s in net["segments"]}
        self.network_km = round(sum(s["length_m"] for s in net["segments"]) / 1000, 1)
        self.network_json = self._network_payload(net)
        import gzip
        self.network_gz = gzip.compress(self.network_json, compresslevel=6)
        del net
        self.states: dict[str, dict] = {}
        self.history: dict[str, deque] = {}
        self.points: deque = deque(maxlen=2880)  # one per 30 s window: a day
        self.current_window: str | None = None
        self.pending_states: OrderedDict[str, dict] = OrderedDict()
        self.vehicles: dict[str, dict] = {}
        self.alerts: deque = deque(maxlen=500)
        self.incidents: OrderedDict[str, dict] = OrderedDict()
        self.predictions: dict[tuple[str, int], dict] = {}
        self.predictions_made_at: str | None = None
        self.model: dict | None = None
        self.rates = {name: Rate(30 if name == "metrics" else 10) for name in ("raw", "valid", "rejected", "metrics", "alerts", "incidents", "predictions")}
        self.reject_reasons: Counter = Counter()
        self.late_events = 0
        self.consumer_errors = 0
        self.latencies: deque[tuple[float, float]] = deque()
        self.last_event: dict | None = None
        self.raw_vehicles: dict[str, float] = {}
        self.kafka = {"connected": False, "bootstrap_host": None, "last_error": None, "reconnects": 0}
        self.lags: dict[str, dict] = {}
        self.throughput: deque = deque(maxlen=360)
        self.listeners: list = []  # callables(event_type, payload)
        self._load_corridors()

    def _load_corridors(self) -> None:
        """The landing's 21 Bengaluru corridors and the live segments under each (config/landing-corridors.json)."""
        import gzip
        path = ROOT / "config" / "landing-corridors.json"
        self.corridor_map = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"region": None, "corridors": {}}
        self.corridor_region = self.corridor_map.get("region")
        self.corridor_segs: dict[str, dict] = {}
        wanted = {s for c in self.corridor_map["corridors"].values() for s in c["segments"]}
        idx_path = ROOT / "data" / "networks" / f"{self.corridor_region}.index.json.gz"
        if wanted and idx_path.exists():
            with gzip.open(idx_path, "rt", encoding="utf-8") as f:
                idx = json.load(f)
            cols = idx["columns"]
            for row in idx["segments"]:
                if row[0] in wanted:
                    self.corridor_segs[row[0]] = dict(zip(cols, row))
        self.side_states: dict[str, dict] = {}
        self.side_predictions: dict[tuple[str, int], dict] = {}
        self.side_vehicles: dict[str, float] = {}

    # ---------- network ----------

    def _network_payload(self, net: dict) -> bytes:
        """The network as the browser needs it: no OSM bookkeeping, and the national tier's shapes
        thinned further so the whole country loads in a browser."""
        national = self.region.get("kind") == "national"
        segs = []
        for s in net["segments"]:
            geom = s["geometry"]
            if national and len(geom) > 2:
                step = max(1, len(geom) // 4)
                geom = geom[::step] + ([geom[-1]] if (len(geom) - 1) % step else [])
            segs.append({k: s[k] for k in ("id", "name", "road_class", "from_node", "to_node", "length_m", "speed_limit_kph", "free_flow_kph", "lanes")} | {"geometry": geom})
        nodes = [{k: n[k] for k in ("id", "name", "lng", "lat")} for n in net["nodes"]]
        body = {"region": self.region, "source": self.source, "nodes": nodes, "segments": segs}
        return json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

    # ---------- ingest (called from the Kafka thread) ----------

    def emit(self, kind: str, payload) -> None:
        for fn in list(self.listeners):
            fn(kind, payload)

    def on_raw(self, ev: dict) -> None:
        self.rates["raw"].add()
        vid = ev.get("vehicle_id")
        if isinstance(vid, str):
            self.raw_vehicles[vid] = time.time()

    def on_valid(self, ev: dict) -> None:
        self.rates["valid"].add()
        if ev.get("region") != self.region_id:
            if ev.get("region") == self.corridor_region:
                self.side_vehicles[ev.get("vehicle_id")] = time.time()
            return
        now = time.time()
        try:
            lag_ms = (datetime.now(timezone.utc) - parse(ev["ts"])).total_seconds() * 1000
            self.latencies.append((now, lag_ms))
        except (KeyError, ValueError):
            pass
        with self.lock:
            self.vehicles[ev["vehicle_id"]] = {
                "vehicle_id": ev["vehicle_id"],
                "vehicle_type": ev["vehicle_type"],
                "lng": ev["lng"],
                "lat": ev["lat"],
                "speed_kph": ev["speed_kph"],
                "heading_deg": ev.get("heading_deg") or 0,
                "segment_id": ev["road_segment_id"],
                "ts": ev["ts"],
                "_seen": now,
            }
            self.last_event = {"event_id": ev["event_id"], "vehicle_id": ev["vehicle_id"], "segment_id": ev["road_segment_id"], "ts": ev["ts"], "processed_at": ev.get("validated_at") or iso()}

    def on_rejected(self, ev: dict) -> None:
        self.rates["rejected"].add()
        self.reject_reasons[ev.get("reason", "unknown")] += 1

    def on_metric(self, m: dict) -> None:
        self.rates["metrics"].add()
        if m.get("region") == self.corridor_region and m["segment_id"] in self.corridor_segs:
            with self.lock:
                self.side_states[m["segment_id"]] = m
        if m.get("region") != self.region_id or m["segment_id"] not in self.segments:
            return
        self.late_events += int(m.get("late_events") or 0)
        state = {k: m[k] for k in (
            "segment_id", "window_start", "window_end", "avg_speed_kph", "free_flow_kph", "speed_ratio", "speed_reduction_pct",
            "vehicle_count", "density_veh_per_km", "flow_veh_per_h", "level", "severity", "trend", "trend_kph_per_min", "reason")}
        with self.lock:
            if self.current_window and m["window_end"] > self.current_window:
                self._close_point(self.current_window)
            if not self.current_window or m["window_end"] > self.current_window:
                self.current_window = m["window_end"]
            self.states[m["segment_id"]] = state
            h = self.history.setdefault(m["segment_id"], deque(maxlen=240))  # two hours of windows
            h.append(state)
            self.pending_states[m["segment_id"]] = state

    def on_alert(self, a: dict) -> None:
        self.rates["alerts"].add()
        with self.lock:
            self.alerts.appendleft(a)
        self.emit("alert", a)

    def on_incident(self, inc: dict) -> None:
        self.rates["incidents"].add()
        with self.lock:
            self.incidents[inc["incident_id"]] = inc
            self.incidents.move_to_end(inc["incident_id"], last=False)
        self.emit("incident", inc)

    def on_prediction(self, p: dict) -> None:
        if p.get("schema") == "arterial.model.v1":
            self.model = {k: v for k, v in p.items() if k not in ("schema", "running_since")}
            return
        self.rates["predictions"].add()
        if p.get("region") == self.corridor_region and p["segment_id"] in self.corridor_segs:
            with self.lock:
                self.side_predictions[(p["segment_id"], int(p["horizon_min"]))] = p
        if p.get("region") != self.region_id:
            return
        p = {k: v for k, v in p.items() if k not in ("schema", "region", "model_kind", "pipeline_version")}
        with self.lock:
            self.predictions[(p["segment_id"], int(p["horizon_min"]))] = p
            self.predictions_made_at = p.get("made_at")

    # ---------- derived views ----------

    def fresh_states(self) -> list[dict]:
        cutoff = iso(datetime.now(timezone.utc) - timedelta(seconds=STALE_S))
        with self.lock:
            return [s for s in self.states.values() if s["window_end"] >= cutoff]

    def _close_point(self, window_end: str) -> None:
        states = self.fresh_states()
        self.points.append(self._point(window_end, states))

    def _point(self, ts: str, states: list[dict]) -> dict:
        by = Counter(s["level"] for s in states)
        weighted = [(s["avg_speed_kph"], self.segments[s["segment_id"]]["length_m"]) for s in states if s["avg_speed_kph"] is not None]
        total_len = sum(w for _, w in weighted)
        avg = round(sum(v * w for v, w in weighted) / total_len, 1) if total_len else None
        congested = sum(self.segments[s["segment_id"]]["length_m"] for s in states if s["level"] in ("heavy", "severe")) / 1000
        return {
            "ts": ts,
            "avg_speed_kph": avg,
            "vehicles": self.active_vehicles(),
            "congested_km": round(congested, 1),
            "flow_veh_per_h": round(sum(s["flow_veh_per_h"] for s in states)),
            "by_level": {lv: by.get(lv, 0) for lv in LEVELS} | {"no_data": len(self.segments) - len(states)},
        }

    def active_vehicles(self, within_s: float = 60) -> int:
        cutoff = time.time() - within_s
        with self.lock:
            return sum(1 for v in self.vehicles.values() if v["_seen"] >= cutoff)

    def summary(self) -> dict:
        states = self.fresh_states()
        p = self._point(iso(), states)
        with self.lock:
            active_inc = sum(1 for i in self.incidents.values() if i.get("status") == "active")
        return {
            "as_of": p["ts"],
            "vehicles_active": p["vehicles"],
            "avg_speed_kph": p["avg_speed_kph"],
            "congested_km": p["congested_km"],
            "network_km": self.network_km,
            "segments_by_level": p["by_level"],
            "events_per_s": self.rates["valid"].per_s(),
            "active_incidents": active_inc,
        }

    def vehicle_sample(self, limit: int = 600) -> list[dict]:
        cutoff = time.time() - 30
        with self.lock:
            vs = [v for v in self.vehicles.values() if v["_seen"] >= cutoff]
        if len(vs) > limit:
            vs = random.Random(int(time.time()) // 60).sample(vs, limit)  # a stable sample for a minute
        return [{k: v for k, v in x.items() if k != "_seen"} for x in vs]

    def take_pending(self) -> list[dict]:
        with self.lock:
            out = list(self.pending_states.values())
            self.pending_states.clear()
            return out

    def latency(self) -> dict:
        now = time.time()
        while self.latencies and now - self.latencies[0][0] > 60:
            self.latencies.popleft()
        xs = sorted(x for _, x in self.latencies)
        if not xs:
            return {"p50": 0, "p95": 0, "max": 0}

        def pct(q):
            return round(xs[min(len(xs) - 1, int(math.ceil(q * len(xs))) - 1)])

        return {"p50": pct(0.5), "p95": pct(0.95), "max": round(xs[-1])}

    def stage_status(self, rate: Rate) -> str:
        """ok while events keep arriving. Window-based topics arrive in a burst every 30 s, so they are
        given a 45 s allowance before they count as late, and 120 s before they count as down."""
        if rate.last_at is None:
            return "unknown"
        age = time.time() - rate.last_at
        windowed = rate is self.rates["metrics"] or rate is self.rates["predictions"] or rate is self.rates["alerts"]
        ok, down = (45, 120) if windowed else (15, 60)
        return "ok" if age < ok else "degraded" if age < down else "down"

    def system(self) -> dict:
        r = self.rates
        raw, valid, rej, met = r["raw"].per_s(), r["valid"].per_s(), r["rejected"].per_s(), r["metrics"].per_s()
        stages = [
            {"id": "simulator", "name": "Telemetry simulator", "kind": "producer", "runs_on": "local", "status": self.stage_status(r["raw"]),
             "events_in_per_s": 0, "events_out_per_s": raw, "last_event_at": _ts(r["raw"].last_at), "errors_total": 0, "downstream": ["telemetry-raw"]},
            {"id": "telemetry-raw", "name": "telemetry-raw", "kind": "topic", "runs_on": "kafka", "status": self.stage_status(r["raw"]),
             "events_in_per_s": raw, "events_out_per_s": raw, "last_event_at": _ts(r["raw"].last_at), "errors_total": 0, "downstream": ["validate"]},
            {"id": "validate", "name": "Validate telemetry", "kind": "transform", "runs_on": "condense", "status": self.stage_status(r["valid"]),
             "events_in_per_s": raw, "events_out_per_s": round(valid + rej, 1), "last_event_at": _ts(r["valid"].last_at),
             "errors_total": r["rejected"].total, "downstream": ["telemetry-valid", "telemetry-rejected"]},
            {"id": "telemetry-valid", "name": "telemetry-valid", "kind": "topic", "runs_on": "kafka", "status": self.stage_status(r["valid"]),
             "events_in_per_s": valid, "events_out_per_s": valid, "last_event_at": _ts(r["valid"].last_at), "errors_total": 0, "downstream": ["window"]},
            {"id": "telemetry-rejected", "name": "telemetry-rejected", "kind": "topic", "runs_on": "kafka", "status": self.stage_status(r["rejected"]),
             "events_in_per_s": rej, "events_out_per_s": rej, "last_event_at": _ts(r["rejected"].last_at), "errors_total": 0, "downstream": ["api"]},
            {"id": "window", "name": "Segment windows", "kind": "transform", "runs_on": "condense", "status": self.stage_status(r["metrics"]),
             "events_in_per_s": valid, "events_out_per_s": met, "last_event_at": _ts(r["metrics"].last_at), "errors_total": 0, "downstream": ["segment-metrics"]},
            {"id": "segment-metrics", "name": "segment-metrics", "kind": "topic", "runs_on": "kafka", "status": self.stage_status(r["metrics"]),
             "events_in_per_s": met, "events_out_per_s": met, "last_event_at": _ts(r["metrics"].last_at), "errors_total": 0, "downstream": ["api"]},
            {"id": "api", "name": "Arterial API", "kind": "api", "runs_on": "local", "status": "ok" if self.kafka["connected"] else "down",
             "events_in_per_s": round(met + rej, 1), "events_out_per_s": 0, "last_event_at": _ts(r["metrics"].last_at), "errors_total": self.consumer_errors, "downstream": []},
        ]
        live = {v for v, t in self.raw_vehicles.items() if time.time() - t < 60}
        return {
            "as_of": iso(),
            "kafka": dict(self.kafka),
            "stages": stages,
            "consumers": list(self.lags.values()),
            "throughput": {"in_per_s": raw, "out_per_s": met},
            "latency_ms": self.latency(),
            "last_event": self.last_event,
            "errors": {
                "validation_rejected": r["rejected"].total,
                "duplicates_dropped": self.reject_reasons.get("duplicate", 0),
                "late_events": self.late_events,
                "consumer_errors": self.consumer_errors,
            },
            "simulation": {"running": self.stage_status(r["raw"]) == "ok", "scenario": "normal", "seed": 2026, "vehicles": len(live), "target_rate": raw},
        }


def _ts(t: float | None) -> str | None:
    return iso(datetime.fromtimestamp(t, timezone.utc)) if t else None


def _level(r: float) -> str:
    return "free" if r >= 0.75 else "moderate" if r >= 0.5 else "heavy" if r >= 0.3 else "severe"


def corridors(state: "State") -> dict:
    """Each landing corridor's live level and its 5, 10 and 15 minute forecasts, length-weighted over the
    live segments under it. A corridor none of whose segments has a recent window is no_data."""
    with state.lock:
        side_states = dict(state.side_states)
        side_predictions = dict(state.side_predictions)
    now_dt = datetime.now(timezone.utc)
    fresh_cut = iso(now_dt - timedelta(seconds=STALE_S))
    pred_cut = iso(now_dt - timedelta(minutes=3))
    levels, preds = {}, []
    made = None
    for cid, c in state.corridor_map["corridors"].items():
        segs = [s for s in c["segments"] if s in state.corridor_segs]
        rows = [(side_states[s], state.corridor_segs[s]["length_m"]) for s in segs
                if s in side_states and side_states[s]["window_end"] >= fresh_cut and side_states[s]["avg_speed_kph"]]
        if rows:
            L = sum(w for _, w in rows)
            v = sum(r["avg_speed_kph"] * w for r, w in rows) / L
            vff = sum(r["free_flow_kph"] * w for r, w in rows) / L
            levels[cid] = _level(v / vff)
        else:
            levels[cid] = "no_data"
        for h in (5, 10, 15):
            ps = [(side_predictions[(s, h)], state.corridor_segs[s]) for s in segs
                  if (s, h) in side_predictions and side_predictions[(s, h)]["made_at"] >= pred_cut]
            if not ps:
                continue
            L = sum(seg["length_m"] for _, seg in ps)
            wavg = lambda f: sum(f(p) * seg["length_m"] for p, seg in ps) / L  # noqa: E731
            vff = sum(seg["free_flow_kph"] * seg["length_m"] for _, seg in ps) / L
            pred = wavg(lambda p: p["predicted_speed_kph"])
            cur = wavg(lambda p: p["current_speed_kph"] or p["predicted_speed_kph"])
            drivers = Counter(d for p, _ in ps for d in p["drivers"][:1])
            made = max(made or "", max(p["made_at"] for p, _ in ps))
            preds.append({
                "segment_id": cid,
                "made_at": max(p["made_at"] for p, _ in ps),
                "horizon_min": h,
                "target_time": max(p["target_time"] for p, _ in ps),
                "current_speed_kph": round(cur, 1),
                "predicted_speed_kph": round(pred, 1),
                "expected_change_kph": round(pred - cur, 1),
                "interval_kph": [round(wavg(lambda p: p["interval_kph"][0]), 1), round(wavg(lambda p: p["interval_kph"][1]), 1)],
                "predicted_level": _level(pred / vff),
                "risk": round(wavg(lambda p: p["risk"]), 3),
                "drivers": [d for d, _ in drivers.most_common(2)],
                "segments": len(ps),
            })
    live_vehicles = sum(1 for t in state.side_vehicles.values() if time.time() - t < 60)
    return {
        "as_of": iso(),
        "region": state.corridor_region,
        "made_at": made,
        "model": state.model,
        "now": levels,
        "predictions": preds,
        "vehicles": live_vehicles,
        "system": state.system(),
    }
