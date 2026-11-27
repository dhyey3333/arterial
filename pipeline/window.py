"""segment-window: telemetry-valid -> segment-metrics, one message per segment per closed 30 s window.

Tumbling windows on event time with 10 s allowed lateness. A window closes when the watermark (the
newest event time seen, or the wall clock if the stream goes quiet, less the lateness) passes its
end. Metrics and levels follow docs/ARCHITECTURE.md section 4: harmonic-mean speed, density from
distinct vehicles scaled by the region's probe share, flow q = k x v, severity, a least-squares
trend, and levels with hysteresis (escalate at once, drop only after two windows below).
"""

from __future__ import annotations

import json
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from pipeline.common import CONFIG, PIPELINE_VERSION, iso, load_networks, parse_ts, topic

C = CONFIG
W = C["window_s"]
LATE = C["allowed_lateness_s"]
RANK = {"free": 0, "moderate": 1, "heavy": 2, "severe": 3}
WORDS = {"free": "Free flow", "moderate": "Moderate", "heavy": "Heavy", "severe": "Severe"}


def clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def raw_level(r: float, k: float, k_jam: float, enough: bool = True) -> str:
    """Density can raise a level only when enough vehicles were seen for it to mean something."""
    lv = C["levels"]
    if r < lv["heavy"]:
        return "severe"
    if r < lv["moderate"] or (enough and k >= C["heavy_density_share"] * k_jam):
        return "heavy"
    if r < lv["free"]:
        return "moderate"
    return "free"


def slope(values: list[float]) -> float:
    """Least-squares slope per window index."""
    n = len(values)
    if n < 2:
        return 0.0
    mx = (n - 1) / 2
    my = sum(values) / n
    num = sum((i - mx) * (v - my) for i, v in enumerate(values))
    den = sum((i - mx) ** 2 for i in range(n))
    return num / den if den else 0.0


class SegmentWindows:
    def __init__(self, networks: dict | None = None):
        self.networks = networks if networks is not None else load_networks()
        self.open: dict[tuple[str, datetime], dict] = {}
        self.max_ts: datetime | None = None
        self.state: dict[str, dict] = defaultdict(lambda: {"level": None, "below": 0, "speeds": deque(maxlen=C["trend_windows"])})
        self.out = topic("segment-metrics")

    def _segment(self, region: str, sid: str) -> dict | None:
        net = self.networks.get(region)
        return net["by_id"].get(sid) if net else None

    def process(self, key, value: str, now: datetime | None = None):
        ev = json.loads(value)
        ts = parse_ts(ev["ts"])
        start = datetime.fromtimestamp(int(ts.timestamp()) // W * W, timezone.utc)
        wm = self.watermark(now)
        late = wm is not None and start + timedelta(seconds=W) <= wm
        if late:
            return []  # its window has already closed
        b = self.open.setdefault((ev["road_segment_id"], start), {"region": ev["region"], "speeds": [], "vehicles": set(), "late": 0})
        b["speeds"].append(float(ev["speed_kph"]))
        b["vehicles"].add(ev["vehicle_id"])
        if self.max_ts and ts < self.max_ts - timedelta(seconds=W):
            b["late"] += 1
        if self.max_ts is None or ts > self.max_ts:
            self.max_ts = ts
        return []

    def watermark(self, now: datetime | None = None) -> datetime | None:
        wall = (now or datetime.now(timezone.utc)) - timedelta(seconds=LATE + 5)
        ev = self.max_ts - timedelta(seconds=LATE) if self.max_ts else None
        return max(x for x in (wall, ev) if x is not None)

    def tick(self, now: datetime | None = None):
        wm = self.watermark(now)
        due = [k for k in self.open if k[1] + timedelta(seconds=W) <= wm]
        out = []
        for k in sorted(due, key=lambda k: k[1]):
            b = self.open.pop(k)
            m = self.metrics(k[0], k[1], b)
            if m:
                out.append((self.out, k[0], json.dumps(m, separators=(",", ":"))))
        return out

    def metrics(self, sid: str, start: datetime, b: dict) -> dict | None:
        seg = self._segment(b["region"], sid)
        if not seg:
            return None
        net = self.networks[b["region"]]
        probe = net["region"].get("probe_share") or 1.0
        vmin = C["min_speed_kph"]
        n = len(b["speeds"])
        v = n / sum(1 / max(x, vmin) for x in b["speeds"])
        vff = float(seg["free_flow_kph"])
        r = v / vff
        km = max(seg["length_m"] / 1000, 0.05)
        count = len(b["vehicles"])
        k = count / km / probe
        k_jam = C["k_jam_pcu_per_km_lane"] * seg.get("lanes", 2) * (1 if seg.get("oneway") else 2)
        q = k * v
        severity = round(70 * clamp((1 - r) / 0.85) + 30 * clamp(k / k_jam))

        st = self.state[sid]
        prev = st["level"]
        st["speeds"].append(v)
        trend_v = slope(list(st["speeds"])) * (60 / W)  # km/h per minute
        trend = "worsening" if trend_v <= -C["trend_kph_per_min"] else "improving" if trend_v >= C["trend_kph_per_min"] else "stable"

        low = count < C["low_sample_vehicles"]
        cand = raw_level(r, k, k_jam, enough=not low)
        if prev is None:
            level = cand
        elif low:
            level = prev
        elif RANK[cand] >= RANK[prev]:
            level, st["below"] = cand, 0
        else:
            st["below"] += 1
            if st["below"] >= C["deescalate_windows"]:
                level, st["below"] = cand, 0
            else:
                level = prev
        st["level"] = level

        why = f"{v:.0f} km/h against {vff:.0f} km/h free flow ({r:.0%})"
        if level == "heavy" and r >= C["levels"]["moderate"]:
            why = f"density {k:.0f} veh/km is at least {C['heavy_density_share']:.0%} of jam density {k_jam:.0f}"
        reason = f"{WORDS[level]}: {why}"
        if low:
            reason += f"; low sample ({count} vehicles), level held"
        elif level != cand:
            reason += f"; holding {level} until {C['deescalate_windows']} windows are lower"
        end = start + timedelta(seconds=W)
        return {
            "schema": "arterial.segment-metrics.v1",
            "segment_id": sid,
            "region": b["region"],
            "window_start": iso(start),
            "window_end": iso(end),
            "avg_speed_kph": round(v, 1),
            "free_flow_kph": vff,
            "speed_ratio": round(r, 3),
            "speed_reduction_pct": round(100 * (1 - r), 1),
            "vehicle_count": count,
            "density_veh_per_km": round(k, 1),
            "flow_veh_per_h": round(q),
            "level": level,
            "severity": severity,
            "trend": trend,
            "trend_kph_per_min": round(trend_v, 2),
            "reason": reason,
            "previous_level": prev,
            "level_changed": prev is not None and prev != level,
            "late_events": b["late"],
            "low_sample": low,
            "pipeline_version": PIPELINE_VERSION,
        }


def main() -> None:
    from pipeline.common import load_env, run

    load_env()
    w = SegmentWindows()
    run("segment-window", [topic("telemetry-valid")], w.process, w.tick)


if __name__ == "__main__":
    main()
