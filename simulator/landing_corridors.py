"""Match the landing's 21 drawn Bengaluru corridors to the live network's segments under them.

The landing draws its corridors from frontend/src/fixtures/network.json (OpenStreetMap shapes, ids like
ORR-01). The pipeline's ids come from the network builder (blr-ORR-07 and so on). This walks each drawn
corridor every 20 m, finds the nearest live segment of the same road within 30 m (any road within 15 m
if none of that name is near), and keeps the segments that run alongside it for at least 40 m or a
third of their length. The API averages those segments' live speeds and forecasts per corridor.

usage: python -m simulator.landing_corridors [region]      (default blr) -> config/landing-corridors.json
"""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STEP = 20.0
CELL = 0.0005  # about 55 m


def _metres(a, b) -> float:
    p = math.radians((a[1] + b[1]) / 2)
    return math.hypot(math.radians(b[0] - a[0]) * math.cos(p) * 6_371_008.8, math.radians(b[1] - a[1]) * 6_371_008.8)


def densify(pts: list, step: float = STEP) -> list:
    out = [tuple(pts[0])]
    for a, b in zip(pts[:-1], pts[1:]):
        d = _metres(a, b)
        n = max(1, int(d // step))
        for i in range(1, n + 1):
            f = i / n
            out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
    return out


def norm(name: str) -> str:
    return "".join(ch for ch in name.lower() if ch.isalnum())


def main(region: str = "blr") -> None:
    drawn = json.loads((ROOT / "frontend" / "src" / "fixtures" / "network.json").read_text(encoding="utf-8"))
    live = json.loads((ROOT / "data" / "networks" / f"{region}.json").read_text(encoding="utf-8"))
    grid: dict[tuple[int, int], list] = defaultdict(list)
    seg_by_id = {s["id"]: s for s in live["segments"]}
    for s in live["segments"]:
        for p in densify(s["geometry"]):
            grid[(int(p[0] / CELL), int(p[1] / CELL))].append((p, s["id"]))

    out = {}
    for c in drawn["segments"]:
        want = norm(c["name"])
        hits: dict[str, float] = defaultdict(float)
        for p in densify(c["geometry"]):
            gx, gy = int(p[0] / CELL), int(p[1] / CELL)
            near = [(q, sid) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for q, sid in grid.get((gx + dx, gy + dy), ())]
            same = [(_metres(p, q), sid) for q, sid in near if want and want in norm(seg_by_id[sid]["name"])]
            same = [x for x in same if x[0] <= 30]
            pick = min(same) if same else min(((_metres(p, q), sid) for q, sid in near), default=None)
            if pick and (same or pick[0] <= 15):
                hits[pick[1]] += STEP
        kept = sorted(
            (sid for sid, m in hits.items() if m >= 40 or m >= seg_by_id[sid]["length_m"] / 3),
            key=lambda sid: -hits[sid],
        )
        covered = sum(min(hits[s], seg_by_id[s]["length_m"]) for s in kept)
        out[c["id"]] = {"name": c["name"], "length_m": c["length_m"], "segments": kept, "matched_m": round(covered)}
        print(f"{c['id']:7s} {c['name'][:24]:24s} {len(kept):2d} segments, {covered / c['length_m']:4.0%} of its length")
    path = ROOT / "config" / "landing-corridors.json"
    path.write_text(json.dumps({"region": region, "corridors": out}, indent=1), encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "blr")
