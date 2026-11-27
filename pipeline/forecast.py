"""congestion-forecast: segment-metrics -> predictions, each segment's speed 5, 10 and 15 minutes ahead.

The rule baseline from docs/ARCHITECTURE.md section 5, which ships first:
    v(t+h) = v(t) + phi_h * slope * h - beta * max(0, upstream density rise), clipped to [2, v_ff]
where slope is the least-squares trend of the last windows (km/h per minute), damped per horizon, and
the upstream term is the rise in density on the segments that feed this one.

Accuracy is measured live, honestly: every forecast is kept until its target window arrives, and the
error is recorded beside persistence ("the speed stays as it is"). The interval around each forecast is
the 10th to 90th percentile of those live errors for that horizon (split conformal), and until enough
errors exist the interval is a fixed width that says so. A model message with these figures goes to the
same topic every minute.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from pipeline.common import CONFIG, PIPELINE_VERSION, iso, load_networks, now_iso, parse_ts, topic

HORIZONS = (5, 10, 15)
# How much of the current trend carries on, per horizon: fully while a build-up is under way (speed
# clearly falling or density rising on the feeding roads), barely on a steady road, where following
# the noise of a few windows only adds error.
PHI_BUILD = {5: 0.9, 10: 0.55, 15: 0.35}
PHI_STEADY = {5: 0.15, 10: 0.08, 15: 0.04}
BUILD_SLOPE = 0.8                        # km/h per minute falling, or
BUILD_RISE = 2.0                         # veh/km more on the feeding roads: a build-up
BETA = 0.08                              # km/h lost per veh/km of density rise upstream
BASE_WINDOWS = 4                         # the starting speed: these windows, weighted by vehicles
FALLBACK_HALF = {5: 4.0, 10: 6.0, 15: 8.0}
MIN_RESIDUALS = 40
MIN_TREND_WINDOWS = 4                    # fewer and the trend is noise: hold the speed instead
MAX_SLOPE = 4.0                          # km/h per minute; a steeper trend is clipped
LV = CONFIG["levels"]
WINDOW_S = CONFIG["window_s"]


def level_of(r: float) -> str:
    return "free" if r >= LV["free"] else "moderate" if r >= LV["moderate"] else "heavy" if r >= LV["heavy"] else "severe"


def quantile(xs: list[float], q: float) -> float:
    xs = sorted(xs)
    i = min(len(xs) - 1, max(0, int(math.ceil(q * len(xs))) - 1))
    return xs[i]


class Forecaster:
    def __init__(self, networks: dict | None = None, **params):
        self.p = {"phi_build": PHI_BUILD, "phi_steady": PHI_STEADY, "build_slope": BUILD_SLOPE, "build_rise": BUILD_RISE,
                  "beta": BETA, "base_windows": BASE_WINDOWS} | params
        self.networks = networks if networks is not None else load_networks()
        self.upstream: dict[str, list[str]] = {}
        for net in self.networks.values():
            into: dict[str, list[str]] = defaultdict(list)
            for sid, s in net["by_id"].items():
                if s.get("to_node"):
                    into[s["to_node"]].append(sid)
                    if not s.get("oneway"):
                        into[s["from_node"]].append(sid)
            for sid, s in net["by_id"].items():
                if s.get("from_node"):
                    feeders = set(into.get(s["from_node"], ()))
                    if not s.get("oneway"):
                        feeders |= set(into.get(s["to_node"], ()))
                    feeders.discard(sid)
                    self.upstream[sid] = sorted(feeders)
        self.speeds: dict[str, deque] = defaultdict(lambda: deque(maxlen=6))
        self.density: dict[str, deque] = defaultdict(lambda: deque(maxlen=3))
        self.recent: dict[str, deque] = defaultdict(lambda: deque(maxlen=self.p["base_windows"]))  # (speed, vehicles)
        self.pending: dict[tuple[str, int], deque] = defaultdict(deque)  # (segment, horizon) -> (target_end, predicted, persistence)
        self.residuals = {h: deque(maxlen=3000) for h in HORIZONS}
        self.persist = {h: deque(maxlen=3000) for h in HORIZONS}
        self.scored = {h: 0 for h in HORIZONS}
        self._q: dict[int, tuple[float, float, int]] = {}
        self.out = topic("predictions")
        self.started = now_iso()
        self.last_model_at: datetime | None = None

    def _score(self, sid: str, end: datetime, v: float) -> None:
        """Record the error of every earlier forecast whose target window this is."""
        for h in HORIZONS:
            q = self.pending.get((sid, h))
            while q and q[0][0] <= end:
                target, pred, base = q.popleft()
                if end - target <= timedelta(seconds=WINDOW_S):
                    self.residuals[h].append(v - pred)
                    self.scored[h] += 1
                    self.persist[h].append(v - base)

    def _interval(self, h: int, pred: float) -> tuple[float, float, bool]:
        r = self.residuals[h]
        if len(r) >= MIN_RESIDUALS:
            # the 10th and 90th percentiles of the live errors, recomputed every 100 new errors (sorting
            # thousands of values for every forecast was most of this stage's CPU)
            cached = self._q.get(h)
            if not cached or abs(self.scored[h] - cached[2]) >= 100:
                xs = list(r)
                cached = (quantile(xs, 0.1), quantile(xs, 0.9), self.scored[h])
                self._q[h] = cached
            return pred + cached[0], pred + cached[1], True
        return pred - FALLBACK_HALF[h], pred + FALLBACK_HALF[h], False

    def process(self, key, value: str, now: datetime | None = None):
        m = json.loads(value)
        sid = m["segment_id"]
        v = m.get("avg_speed_kph")
        if v is None:
            return []
        net = self.networks.get(m.get("region"))
        if not net or sid not in net["by_id"]:
            return []
        vff = float(m["free_flow_kph"])
        end = parse_ts(m["window_end"])
        self._score(sid, end, v)
        # only windows with enough vehicles feed the trend; a single car's speed is not the road's
        if not m.get("low_sample"):
            self.speeds[sid].append(v)
        self.density[sid].append(float(m["density_veh_per_km"]))
        self.recent[sid].append((v, max(1, int(m.get("vehicle_count") or 1))))
        # the starting speed: the last few windows pooled by their vehicles, steadier than one window
        weight = sum(c for _, c in self.recent[sid])
        base = sum(x * c for x, c in self.recent[sid]) / weight

        speeds = list(self.speeds[sid])
        n = len(speeds)
        if n >= MIN_TREND_WINDOWS:
            mx, my = (n - 1) / 2, sum(speeds) / n
            den = sum((i - mx) ** 2 for i in range(n))
            slope = sum((i - mx) * (s - my) for i, s in enumerate(speeds)) / den * (60 / WINDOW_S)
            slope = max(-MAX_SLOPE, min(MAX_SLOPE, slope))
        else:
            slope = 0.0
        rises = []
        for u in self.upstream.get(sid, ()):
            d = self.density.get(u)
            if d and len(d) >= 2:
                rises.append(d[-1] - d[0])
        rise = max(0.0, sum(rises) / len(rises)) if rises else 0.0

        building = slope <= -self.p["build_slope"] or rise >= self.p["build_rise"]
        phi = self.p["phi_build"] if building else self.p["phi_steady"]
        outs = []
        made_at = now_iso()
        for h in HORIZONS:
            pred = base + phi[h] * slope * h - self.p["beta"] * rise
            pred = max(2.0, min(vff, pred))
            lo, hi, calibrated = self._interval(h, pred)
            lo, hi = max(0.0, lo), min(vff * 1.1, hi)
            heavy = LV["moderate"] * vff
            risk = 0.0 if hi <= lo else max(0.0, min(1.0, (heavy - lo) / (hi - lo)))
            drivers = []
            if abs(slope) >= 0.5:
                drivers.append(f"Speed {'falling' if slope < 0 else 'rising'} {abs(slope):.1f} km/h per minute over the last {n} windows")
            if rise >= 1:
                drivers.append(f"Density up {rise:.0f} veh/km on {len(rises)} feeding road{'s' if len(rises) != 1 else ''}")
            if m["level"] in ("heavy", "severe"):
                drivers.append(f"Already {m['level']} now")
            if not calibrated:
                drivers.append(f"Interval is a fixed ±{FALLBACK_HALF[h]:.0f} km/h until {MIN_RESIDUALS} forecasts at this horizon have been checked")
            target = end + timedelta(minutes=h)
            self.pending[(sid, h)].append((target, pred, v))
            p = {
                "schema": "arterial.prediction.v1",
                "segment_id": sid,
                "region": m["region"],
                "made_at": made_at,
                "horizon_min": h,
                "target_time": iso(target),
                "current_speed_kph": round(v, 1),
                "predicted_speed_kph": round(pred, 1),
                "expected_change_kph": round(pred - v, 1),
                "interval_kph": [round(lo, 1), round(hi, 1)],
                "predicted_level": level_of(pred / vff),
                "risk": round(risk, 3),
                "drivers": drivers,
                "model_kind": "rule_baseline",
                "pipeline_version": PIPELINE_VERSION,
            }
            outs.append((self.out, sid, json.dumps(p, separators=(",", ":"))))
        return outs

    def model(self) -> dict:
        ev = []
        for h in HORIZONS:
            r, b = list(self.residuals[h]), list(self.persist[h])
            if not r:
                continue
            ev.append({
                "horizon_min": h,
                "mae_kph": round(sum(abs(x) for x in r) / len(r), 2),
                "rmse_kph": round(math.sqrt(sum(x * x for x in r) / len(r)), 2),
                "baseline_mae_kph": round(sum(abs(x) for x in b) / len(b), 2),
                "baseline_rmse_kph": round(math.sqrt(sum(x * x for x in b) / len(b)), 2),
                "n": len(r),
            })
        return {
            "schema": "arterial.model.v1",
            "name": "congestion-forecast",
            "version": PIPELINE_VERSION,
            "region": ",".join(sorted(self.networks)),
            "kind": "rule_baseline",
            "description": "Vehicle-weighted speed of the last windows plus its trend (followed fully only during a build-up) "
                           "minus upstream density pressure, clipped to free flow. "
                           "Errors are measured live against each forecast's target window, beside persistence.",
            "trained_at": None,
            "training_windows": 0,
            "evaluated_at": now_iso() if ev else None,
            "evaluation": ev,
            "running_since": self.started,
        }

    def tick(self, now: datetime | None = None):
        now = now or datetime.now(timezone.utc)
        if self.last_model_at and (now - self.last_model_at).total_seconds() < 60:
            return []
        self.last_model_at = now
        return [(self.out, "model", json.dumps(self.model(), separators=(",", ":")))]


def main() -> None:
    from pipeline.common import load_env, run

    load_env()
    f = Forecaster()
    run("congestion-forecast", [topic("segment-metrics")], f.process, f.tick)


if __name__ == "__main__":
    main()
