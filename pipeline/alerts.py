"""alert-router: segment-metrics -> congestion-alerts (docs/ARCHITECTURE.md section 3).

The Condense Library in this sandbox has no Split or Alerts utility (section 3.1), so this custom transform
does their job with the same rules:
  emerging   a segment's level rises into heavy or severe from free or moderate
  escalated  heavy becomes severe
  sustained  severe for 2 minutes in a row (4 windows), once per episode
  cleared    a segment that was heavy or severe drops to moderate or free
The window stage already holds levels with hysteresis, so a level change here is a settled one.
"""

from __future__ import annotations

import json
import uuid
from collections import defaultdict

from pipeline.common import PIPELINE_VERSION, now_iso, topic

CONGESTED = ("heavy", "severe")
SUSTAIN_WINDOWS = 4
WORDS = {"free": "free flow", "moderate": "moderate", "heavy": "heavy", "severe": "severe", "no_data": "no data"}


class AlertRouter:
    def __init__(self):
        self.out = topic("congestion-alerts")
        self.severe_run: dict[str, int] = defaultdict(int)
        self.sustained_sent: set[str] = set()

    def _alert(self, m: dict, kind: str, frm: str, to: str, message: str):
        a = {
            "schema": "arterial.alert.v1",
            "alert_id": str(uuid.uuid4()),
            "segment_id": m["segment_id"],
            "region": m.get("region"),
            "kind": kind,
            "level_from": frm,
            "level_to": to,
            "raised_at": now_iso(),
            "window_end": m["window_end"],
            "message": message,
            "pipeline_version": PIPELINE_VERSION,
        }
        return (self.out, m["segment_id"], json.dumps(a, separators=(",", ":")))

    def process(self, key, value: str):
        m = json.loads(value)
        sid, level, prev = m["segment_id"], m["level"], m.get("previous_level")
        speed = m.get("avg_speed_kph")
        tail = f" ({speed:.0f} km/h against {m['free_flow_kph']:.0f} km/h free flow)" if speed is not None else ""
        outs = []
        if level == "severe":
            self.severe_run[sid] += 1
        else:
            self.severe_run.pop(sid, None)
            self.sustained_sent.discard(sid)
        if m.get("level_changed") and prev:
            if level in CONGESTED and prev not in CONGESTED:
                outs.append(self._alert(m, "emerging", prev, level, f"Turned {WORDS[level]} from {WORDS[prev]}{tail}"))
            elif prev == "heavy" and level == "severe":
                outs.append(self._alert(m, "escalated", prev, level, f"Worsened from heavy to severe{tail}"))
            elif prev in CONGESTED and level not in CONGESTED:
                outs.append(self._alert(m, "cleared", prev, level, f"Cleared to {WORDS[level]} from {WORDS[prev]}{tail}"))
        if self.severe_run.get(sid, 0) >= SUSTAIN_WINDOWS and sid not in self.sustained_sent:
            self.sustained_sent.add(sid)
            outs.append(self._alert(m, "sustained", "severe", "severe", f"Severe for {SUSTAIN_WINDOWS * 30 // 60} minutes{tail}"))
        return outs


def main() -> None:
    from pipeline.common import load_env, run

    load_env()
    r = AlertRouter()
    run("alert-router", [topic("segment-metrics")], r.process)


if __name__ == "__main__":
    main()
