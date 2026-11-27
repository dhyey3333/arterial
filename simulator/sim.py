"""Seeded traffic simulator: synthetic vehicles drive a region's real road network and report
telemetry (arterial.telemetry.v1, docs/EVENTS.md) to the team's telemetry-raw topic.

Traffic is simulated, never real. Each segment's speed follows a demand model: a Bengaluru
time-of-day profile times the segment's own load (seeded), with a slow random drift, through a
BPR-style speed curve. Scenarios change that load: "build_up" slowly overloads a stretch of road,
"incident" nearly blocks one segment and backs traffic up behind it. A small share of events is
deliberately bad (missing GPS, duplicates, out of order, impossible coordinates, unknown segment)
so the validation stage has something to reject.

usage:
  python -m simulator.sim --region blr                      # to Kafka, settings from .env
  python -m simulator.sim --region blr --sink stdout --seconds 20
  python -m simulator.sim --region blr --scenario build_up
"""

from __future__ import annotations

import argparse
import bisect
import heapq
import json
import math
import os
import random
import signal
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
IST = timezone(timedelta(hours=5, minutes=30))
VEHICLE_TYPES = [("two_wheeler", 0.45, 1.05), ("car", 0.30, 1.0), ("auto_rickshaw", 0.12, 0.88), ("bus", 0.05, 0.8), ("truck", 0.08, 0.75)]
CLASS_LOAD = {"motorway": 0.85, "trunk": 0.95, "primary": 0.9, "secondary": 0.75, "tertiary": 0.6}
BAD_KINDS = ["missing_gps", "duplicate", "out_of_order", "out_of_bounds", "unknown_segment"]


def load_env(path: Path = ROOT / ".env") -> None:
    """Read KEY=VALUE lines into os.environ without overriding what is already set."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def demand(t: datetime) -> float:
    """Share of peak demand by local time of day: a quiet night, a morning and a longer evening peak."""
    h = t.astimezone(IST).hour + t.astimezone(IST).minute / 60
    peaks = 0.95 * math.exp(-((h - 9.75) ** 2) / (2 * 1.3**2)) + 1.0 * math.exp(-((h - 18.5) ** 2) / (2 * 1.7**2))
    day = 0.55 * math.exp(-((h - 14) ** 2) / (2 * 4.5**2))
    return 0.12 + max(peaks, day)


def speed_ratio(load: float) -> float:
    """BPR-style: about 0.55 of free flow at load 1, heavy near 1.2, severe past 1.4."""
    return 1.0 / (1.0 + 0.8 * max(load, 0.0) ** 4)


@dataclass
class Edge:
    seg: dict
    pts: list[tuple[float, float]]
    cum: list[float]
    to: str
    reverse: bool

    @property
    def length(self) -> float:
        return self.cum[-1]


@dataclass
class Vehicle:
    vid: str
    vtype: str
    factor: float
    node: str
    route: list[Edge] = field(default_factory=list)
    pos: float = 0.0
    seq: int = 0
    next_report: float = 0.0
    last_event: dict | None = None


class Network:
    def __init__(self, region: str):
        net = json.loads((ROOT / "data" / "networks" / f"{region}.json").read_text(encoding="utf-8"))
        self.region = net["region"]
        self.nodes = {n["id"]: n for n in net["nodes"]}
        self.segments = {s["id"]: s for s in net["segments"]}
        self.out: dict[str, list[Edge]] = {n: [] for n in self.nodes}
        for s in net["segments"]:
            pts = [tuple(p) for p in s["geometry"]]
            self.out[s["from_node"]].append(self._edge(s, pts, s["to_node"], False))
            if not s.get("oneway"):
                self.out[s["to_node"]].append(self._edge(s, pts[::-1], s["from_node"], True))
        self.node_ids = [n for n, edges in self.out.items() if edges]

    @staticmethod
    def _edge(seg, pts, to, reverse) -> Edge:
        cum = [0.0]
        for (x1, y1), (x2, y2) in zip(pts[:-1], pts[1:]):
            cum.append(cum[-1] + _metres(x1, y1, x2, y2))
        scale = seg["length_m"] / cum[-1] if cum[-1] > 0 else 1.0
        return Edge(seg, pts, [c * scale for c in cum], to, reverse)

    def route(self, start: str, goal: str) -> list[Edge]:
        """Dijkstra on free-flow time."""
        dist = {start: 0.0}
        prev: dict[str, tuple[str, Edge]] = {}
        heap = [(0.0, start)]
        while heap:
            d, u = heapq.heappop(heap)
            if u == goal:
                break
            if d > dist.get(u, math.inf):
                continue
            for e in self.out[u]:
                nd = d + e.length / max(e.seg["free_flow_kph"], 5)
                if nd < dist.get(e.to, math.inf):
                    dist[e.to] = nd
                    prev[e.to] = (u, e)
                    heapq.heappush(heap, (nd, e.to))
        if goal not in prev:
            return []
        path, cur = [], goal
        while cur != start:
            u, e = prev[cur]
            path.append(e)
            cur = u
        return path[::-1]


def _metres(x1, y1, x2, y2) -> float:
    p = math.radians((y1 + y2) / 2)
    dx = math.radians(x2 - x1) * math.cos(p) * 6_371_008.8
    dy = math.radians(y2 - y1) * 6_371_008.8
    return math.hypot(dx, dy)


def _heading(x1, y1, x2, y2) -> float:
    p = math.radians((y1 + y2) / 2)
    return (math.degrees(math.atan2(math.radians(x2 - x1) * math.cos(p), math.radians(y2 - y1))) + 360) % 360


class Traffic:
    """Each segment's load and speed now, with the active scenario applied."""

    def __init__(self, net: Network, rng: random.Random):
        self.net = net
        self.base = {sid: 0.88 * CLASS_LOAD.get(s["road_class"], 0.7) * rng.lognormvariate(0.0, 0.25) for sid, s in net.segments.items()}
        self.drift = {sid: 0.0 for sid in net.segments}
        self.rng = rng
        self.scenario: dict | None = None
        # segments that lead into each segment, for back-ups behind an incident
        into: dict[str, set[str]] = {sid: set() for sid in net.segments}
        ends: dict[str, list[str]] = {}
        for sid, s in net.segments.items():
            for n in (s["from_node"], s["to_node"]):
                ends.setdefault(n, []).append(sid)
        for sid, s in net.segments.items():
            for n in (s["from_node"], s["to_node"]):
                into[sid].update(x for x in ends[n] if x != sid)
        self.into = into

    def step(self, dt: float) -> None:
        a = math.exp(-dt / 600)  # drift wanders over about ten minutes
        sd = 0.12 * math.sqrt(1 - a * a)
        for sid in self.drift:
            self.drift[sid] = a * self.drift[sid] + self.rng.gauss(0, sd)

    def start(self, kind: str, segment_id: str, now: datetime, minutes: float) -> None:
        upstream = set(self.into.get(segment_id, ()))
        second = set().union(*(self.into[u] for u in upstream)) - upstream - {segment_id} if upstream else set()
        self.scenario = {"kind": kind, "segment": segment_id, "upstream": upstream, "second": second, "start": now, "minutes": minutes}

    def load(self, sid: str, now: datetime) -> float:
        x = demand(now) * self.base[sid] * (1 + self.drift[sid])
        sc = self.scenario
        if sc:
            age = (now - sc["start"]).total_seconds() / 60
            if age > sc["minutes"]:
                self.scenario = None
            elif sc["kind"] == "build_up":
                ramp = min(age / (0.6 * sc["minutes"]), 1.0)
                if sid == sc["segment"]:
                    x *= 1 + 2.4 * ramp
                elif sid in sc["upstream"]:
                    x *= 1 + 1.3 * ramp
                elif sid in sc["second"]:
                    x *= 1 + 0.5 * ramp
            elif sc["kind"] == "incident":
                if sid == sc["segment"]:
                    return 3.0
                spill = min(age / 4, 1.0)
                if sid in sc["upstream"]:
                    x *= 1 + 0.9 * spill
                elif sid in sc["second"]:
                    x *= 1 + 0.4 * spill
        return x

    def speed(self, edge: Edge, now: datetime) -> float:
        return edge.seg["free_flow_kph"] * speed_ratio(self.load(edge.seg["id"], now))


class Sink:
    def __init__(self, kind: str, topic: str):
        self.kind, self.topic, self.sent, self.failed = kind, topic, 0, 0
        self.producer = None
        if kind == "kafka":
            from confluent_kafka import Producer

            conf = {
                "bootstrap.servers": os.environ["KAFKA_BOOTSTRAP_SERVERS"],
                "security.protocol": os.environ.get("KAFKA_SECURITY_PROTOCOL", "SASL_SSL"),
                "client.id": "arterial-simulator",
                "linger.ms": 50,
                "compression.type": "lz4",
            }
            if os.environ.get("KAFKA_SASL_MECHANISM"):
                conf["sasl.mechanism"] = os.environ["KAFKA_SASL_MECHANISM"]
            if os.environ.get("KAFKA_USERNAME"):
                conf["sasl.username"] = os.environ["KAFKA_USERNAME"]
                conf["sasl.password"] = os.environ.get("KAFKA_PASSWORD", "")
            self.producer = Producer(conf)

    def _done(self, err, _msg) -> None:
        if err:
            self.failed += 1
            if self.failed <= 5:
                print(f"delivery failed: {err}", file=sys.stderr)

    def send(self, key: str, value: str) -> None:
        if self.kind == "kafka":
            while True:
                try:
                    self.producer.produce(self.topic, key=key.encode(), value=value.encode(), on_delivery=self._done)
                    break
                except BufferError:
                    self.producer.poll(0.2)
            self.producer.poll(0)
        elif self.kind == "stdout":
            print(value)
        self.sent += 1

    def flush(self) -> None:
        if self.producer:
            self.producer.flush(10)


class Simulator:
    def __init__(self, region: str, vehicles: int, seed: int, report_s: float, bad_share: float, sink: Sink):
        self.cfg = yaml.safe_load((ROOT / "config" / "regions" / f"{region}.yaml").read_text(encoding="utf-8"))
        self.net = Network(region)
        self.rng = random.Random(seed)
        self.traffic = Traffic(self.net, random.Random(seed + 1))
        self.report_s, self.bad_share, self.sink = report_s, bad_share, sink
        self.run_id = f"run-{datetime.now(IST):%Y-%m-%d-%H%M}"
        bbox = self.net.region["bbox"]
        self.bbox = bbox
        weights = [w for _, w, _ in VEHICLE_TYPES]
        self.vehicles = []
        for i in range(vehicles):
            vtype, _, factor = self.rng.choices(VEHICLE_TYPES, weights)[0]
            v = Vehicle(f"SIM-V-{i + 1:04d}", vtype, factor, self.rng.choice(self.net.node_ids))
            v.next_report = self.rng.uniform(0, report_s)
            self.vehicles.append(v)

    def find_segment(self, road: str, near: str) -> str | None:
        """The segment of `road` closest to a junction whose name mentions `near`."""
        anchors = [n for n in self.net.nodes.values() if near.lower() in n["name"].lower()]
        cands = [s for s in self.net.segments.values() if road.lower() in s["name"].lower()]
        if not cands:
            return None
        if not anchors:
            return cands[0]["id"]

        def gap(s):
            mid = s["geometry"][len(s["geometry"]) // 2]
            return min(_metres(mid[0], mid[1], a["lng"], a["lat"]) for a in anchors)

        return min(cands, key=gap)["id"]

    def wander(self, v: Vehicle, legs: int = 40) -> None:
        """National tier: drive on along the highways, preferring to stay on the same road, never
        turning straight back. Cheap enough for thousands of vehicles on a country-sized network."""
        route, node, last = [], v.node, None
        for _ in range(legs):
            options = [e for e in self.net.out[node] if not (last and e.seg["id"] == last.seg["id"])] or self.net.out[node]
            if not options:
                break
            weights = [4.0 if last and e.seg["name"] == last.seg["name"] else 1.0 for e in options]
            e = self.rng.choices(options, weights)[0]
            route.append(e)
            node, last = e.to, e
        v.route, v.pos = route, 0.0

    def new_trip(self, v: Vehicle) -> None:
        if self.net.region["kind"] == "national":
            self.wander(v)
            return
        for _ in range(5):
            goal = self.rng.choice(self.net.node_ids)
            if goal != v.node:
                route = self.net.route(v.node, goal)
                if route:
                    v.route, v.pos = route, 0.0
                    return
        v.node = self.rng.choice(self.net.node_ids)  # stranded: start again somewhere else

    def event(self, v: Vehicle, now: datetime, speed: float) -> dict:
        e = v.route[0]
        i = max(1, bisect.bisect_right(e.cum, v.pos))
        i = min(i, len(e.pts) - 1)
        (x1, y1), (x2, y2) = e.pts[i - 1], e.pts[i]
        span = e.cum[i] - e.cum[i - 1]
        f = (v.pos - e.cum[i - 1]) / span if span > 0 else 0.0
        v.seq += 1
        return {
            "schema": "arterial.telemetry.v1",
            "event_id": str(uuid.UUID(int=self.rng.getrandbits(128), version=4)),
            "vehicle_id": v.vid,
            "vehicle_type": v.vtype,
            "ts": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "lat": round(y1 + (y2 - y1) * f, 6),
            "lng": round(x1 + (x2 - x1) * f, 6),
            "speed_kph": round(max(speed, 0.0), 1),
            "heading_deg": round(_heading(x1, y1, x2, y2), 1),
            "region": self.net.region["id"],
            "road_segment_id": e.seg["id"],
            "seq": v.seq,
            "source": "simulated",
            "sim_run_id": self.run_id,
        }

    def spoil(self, ev: dict, v: Vehicle) -> dict | None:
        """Turn a good event into one of the bad kinds; None means send the last one again."""
        kind = self.rng.choice(BAD_KINDS)
        if kind == "missing_gps":
            ev["lat"] = None
        elif kind == "duplicate":
            return None
        elif kind == "out_of_order":
            ev["seq"] = max(1, ev["seq"] - self.rng.randint(2, 6))
        elif kind == "out_of_bounds":
            ev["lat"], ev["lng"] = round(self.rng.uniform(-80, 80), 6), round(self.rng.uniform(-170, 170), 6)
        else:
            ev["road_segment_id"] = f"{self.net.region['id']}-NOPE-{self.rng.randint(1, 99):02d}"
        return ev

    def tick(self, now: datetime, t: float, dt: float) -> None:
        self.traffic.step(dt)
        for v in self.vehicles:
            if not v.route:
                self.new_trip(v)
                if not v.route:
                    continue
            e = v.route[0]
            speed = self.traffic.speed(e, now) * v.factor * self.rng.lognormvariate(0, 0.08)
            v.pos += speed / 3.6 * dt
            while v.route and v.pos >= v.route[0].length:
                v.pos -= v.route[0].length
                v.node = v.route[0].to
                v.route.pop(0)
            if not v.route:
                continue
            if t >= v.next_report:
                v.next_report = t + self.report_s
                ev = self.event(v, now, speed)
                if self.rng.random() < self.bad_share:
                    bad = self.spoil(dict(ev), v)
                    if bad is None and v.last_event:
                        self.sink.send(v.last_event["road_segment_id"], json.dumps(v.last_event))
                        continue
                    if bad is not None:
                        ev = bad
                v.last_event = ev
                self.sink.send(ev["road_segment_id"], json.dumps(ev, separators=(",", ":")))


def main() -> None:
    load_env()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region", default=os.environ.get("ARTERIAL_REGION", "blr"))
    ap.add_argument("--sink", choices=["kafka", "stdout", "null"], default="kafka")
    ap.add_argument("--topic", default=None, help="default: <TEAM_PREFIX>.telemetry-raw")
    ap.add_argument("--vehicles", type=int, default=None)
    ap.add_argument("--seed", type=int, default=int(os.environ.get("SIM_SEED", 2026)))
    ap.add_argument("--report-s", type=float, default=5.0, help="seconds between one vehicle's reports")
    ap.add_argument("--bad-share", type=float, default=0.02)
    ap.add_argument("--scenario", choices=["normal", "build_up", "incident"], default=os.environ.get("SIM_SCENARIO", "normal"))
    ap.add_argument("--scenario-delay", type=float, default=60, help="seconds before the scenario starts")
    ap.add_argument("--scenario-minutes", type=float, default=20)
    ap.add_argument("--seconds", type=float, default=0, help="stop after this many seconds (0 runs until stopped)")
    args = ap.parse_args()

    cfg = yaml.safe_load((ROOT / "config" / "regions" / f"{args.region}.yaml").read_text(encoding="utf-8"))
    vehicles = args.vehicles or int(os.environ.get("SIM_VEHICLES") or cfg["fleet"]["vehicles"])
    topic = args.topic or os.environ.get("TOPIC_TELEMETRY_RAW") or os.environ.get("TEAM_PREFIX", "arterial_") + "telemetry-raw"
    sink = Sink(args.sink, topic)
    sim = Simulator(args.region, vehicles, args.seed, args.report_s, args.bad_share, sink)
    target = None
    if args.scenario != "normal":
        where = cfg.get("scenarios", {}).get(args.scenario, {})
        target = sim.find_segment(where.get("road", ""), where.get("near", ""))
        print(f"scenario {args.scenario} on {target} in {args.scenario_delay:.0f} s", file=sys.stderr)
    print(
        f"{args.region}: {vehicles} vehicles on {len(sim.net.segments):,} segments, reporting every {args.report_s:g} s "
        f"(about {vehicles / args.report_s:.0f} events/s) to {args.sink}:{topic}",
        file=sys.stderr,
    )

    stop = False

    def _stop(*_):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGINT, _stop)
    t0 = time.monotonic()
    last, last_log, last_sent = t0, t0, 0
    started = False
    while not stop:
        now_m = time.monotonic()
        dt = now_m - last
        last = now_m
        t = now_m - t0
        now = datetime.now(timezone.utc)
        if target and not started and t >= args.scenario_delay:
            sim.traffic.start(args.scenario, target, now, args.scenario_minutes)
            started = True
            print(f"scenario {args.scenario} started on {target}", file=sys.stderr)
        sim.tick(now, t, dt)
        if now_m - last_log >= 10:
            rate = (sink.sent - last_sent) / (now_m - last_log)
            print(f"[{t:6.0f} s] sent {sink.sent:,} ({rate:.0f}/s), failed {sink.failed}", file=sys.stderr)
            last_log, last_sent = now_m, sink.sent
        if args.seconds and t >= args.seconds:
            break
        time.sleep(max(0.0, 1.0 - (time.monotonic() - now_m)))
    sink.flush()
    print(f"stopped: sent {sink.sent:,}, failed {sink.failed}", file=sys.stderr)


if __name__ == "__main__":
    main()
