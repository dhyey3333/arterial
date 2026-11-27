"""Routes on the region's road network under current conditions (docs/ARCHITECTURE.md, section 7),
and junction search for the route form."""

from __future__ import annotations

import heapq
import math

from api.state import LEVELS, State, iso

R = 6_371_008.8


def _dist(a: dict, b: dict) -> float:
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dp, dl = p2 - p1, math.radians(b["lng"] - a["lng"])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


class Router:
    def __init__(self, state: State):
        self.s = state
        self.out: dict[str, list[tuple[str, str, bool]]] = {n: [] for n in state.nodes}
        for sid, seg in state.segments.items():
            self.out[seg["from_node"]].append((seg["to_node"], sid, False))
            if not seg.get("oneway"):
                self.out[seg["to_node"]].append((seg["from_node"], sid, True))
        self.vmax = max(s["free_flow_kph"] for s in state.segments.values()) / 3.6

    def speeds(self) -> dict[str, float]:
        return {s["segment_id"]: s["avg_speed_kph"] for s in self.s.fresh_states() if s["avg_speed_kph"]}

    def _search(self, origin: str, goal: str, cost) -> list[tuple[str, str, bool]] | None:
        g = self.s.nodes[goal]
        dist = {origin: 0.0}
        prev: dict[str, tuple[str, str, bool]] = {}
        heap = [(0.0, origin)]
        done = set()
        while heap:
            _, u = heapq.heappop(heap)
            if u == goal:
                break
            if u in done:
                continue
            done.add(u)
            for v, sid, rev in self.out.get(u, ()):
                nd = dist[u] + cost(sid)
                if nd < dist.get(v, math.inf):
                    dist[v] = nd
                    prev[v] = (u, sid, rev)
                    heapq.heappush(heap, (nd + _dist(self.s.nodes[v], g) / self.vmax, v))
        if goal not in prev and goal != origin:
            return None
        path, cur = [], goal
        while cur != origin:
            u, sid, rev = prev[cur]
            path.append((cur, sid, rev))
            cur = u
        return path[::-1]

    def _option(self, origin: str, path, speeds) -> dict:
        nodes, segs, geom = [origin], [], []
        dist = eta = ff = 0.0
        exposure = {lv: 0.0 for lv in LEVELS + ["no_data"]}
        fresh = {s["segment_id"]: s["level"] for s in self.s.fresh_states()}
        for node, sid, rev in path:
            seg = self.s.segments[sid]
            nodes.append(node)
            segs.append(sid)
            L = seg["length_m"]
            dist += L
            eta += L / (speeds.get(sid, seg["free_flow_kph"]) / 3.6)
            ff += L / (seg["free_flow_kph"] / 3.6)
            exposure[fresh.get(sid, "no_data")] += L
            g = seg["geometry"][::-1] if rev else seg["geometry"]
            geom.extend(g if not geom else g[1:])
        return {
            "node_ids": nodes,
            "segment_ids": segs,
            "distance_m": round(dist),
            "eta_s": round(eta),
            "free_flow_eta_s": round(ff),
            "delay_s": round(eta - ff),
            "exposure_m": {k: round(v) for k, v in exposure.items()},
            "geometry": geom,
        }

    def route(self, origin: str, destination: str) -> dict | None:
        speeds = self.speeds()

        def now_cost(sid):
            seg = self.s.segments[sid]
            return seg["length_m"] / (speeds.get(sid, seg["free_flow_kph"]) / 3.6)

        def ff_cost(sid):
            seg = self.s.segments[sid]
            return seg["length_m"] / (seg["free_flow_kph"] / 3.6)

        best = self._search(origin, destination, now_cost)
        if best is None:
            return None
        usual = self._search(origin, destination, ff_cost)
        rec = self._option(origin, best, speeds)
        ff_opt = self._option(origin, usual, speeds)
        used = set(rec["segment_ids"])

        def alt_cost(sid):
            return now_cost(sid) * (1.6 if sid in used else 1.0)

        alt = None
        alt_path = self._search(origin, destination, alt_cost)
        if alt_path:
            cand = self._option(origin, alt_path, speeds)
            shared = sum(self.s.segments[s]["length_m"] for s in cand["segment_ids"] if s in used)
            if cand["segment_ids"] != rec["segment_ids"] and shared < 0.6 * cand["distance_m"]:
                alt = cand
        saved = max(0, ff_opt["eta_s"] - rec["eta_s"])
        congested = rec["exposure_m"]["heavy"] + rec["exposure_m"]["severe"]
        why = [
            f"Fastest under current conditions: {rec['distance_m'] / 1000:.1f} km in about {rec['eta_s'] / 60:.0f} min "
            f"({rec['delay_s'] / 60:+.0f} min against free flow).",
        ]
        if saved >= 60:
            why.append(f"The usual fastest route takes about {ff_opt['eta_s'] / 60:.0f} min right now; this one saves about {saved / 60:.0f} min.")
        else:
            why.append("The usual fastest route is as quick right now, so this is it.")
        if congested:
            why.append(f"{congested / 1000:.1f} km of it is heavy or severe at the moment.")
        no_data = rec["exposure_m"]["no_data"]
        if no_data:
            why.append(f"{no_data / 1000:.1f} km has no recent reports and is timed at free-flow speed.")
        return {
            "as_of": iso(),
            "origin": origin,
            "destination": destination,
            "algorithm": "a_star",
            "recommended": rec,
            "alternative": alt,
            "free_flow_fastest": ff_opt,
            "time_saved_s": saved,
            "explanation": why,
        }

    def places(self, q: str, limit: int) -> list[dict]:
        q = q.strip().lower()
        if len(q) < 2:
            return []
        scored = []
        for n in self.s.nodes.values():
            name = n["name"].lower()
            roads = [r.lower() for r in n.get("roads", [])]
            if name.startswith(q):
                score = 0
            elif q in name:
                score = 1
            elif any(q in r for r in roads):
                score = 2
            else:
                continue
            scored.append((score, -len(roads), n["name"], n))
        scored.sort(key=lambda x: x[:3])
        out, seen = [], set()
        for _, _, name, n in scored:
            if name in seen:
                continue
            seen.add(name)
            out.append({"kind": "junction", "name": n["name"], "context": None, "lng": n["lng"], "lat": n["lat"], "node_id": n["id"], "roads": n.get("roads", []), "distance_m": 0})
            if len(out) >= limit:
                break
        return out
