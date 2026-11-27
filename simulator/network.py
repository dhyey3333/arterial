"""Cut one region's road network out of the India cache and write it in the RoadNetwork shape.

Steps (docs/ARCHITECTURE.md, section 2.1): keep the region's road classes inside its box, split
roads at junctions (and where a road changes name, class or direction), cap a segment at
max_segment_km, keep the largest connected piece so every junction can be routed to, simplify the
geometry for the browser, and give stable ids: segments <region>-<road code>-<nn>, numbered along
the road; junctions <region>-N<nnnnn>.

usage: python -m simulator.network blr      (needs data/raw/india-roads.npz from osm_extract)
"""

from __future__ import annotations

import gzip
import json
import math
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "networks"
CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary"]

# speed limit, free-flow speed (km/h) and lanes by class, before any history exists
DEFAULTS = {
    "city": {"limit": [80, 60, 50, 40, 30], "free": [65, 48, 40, 32, 26], "lanes": [3, 3, 2, 2, 1]},
    "national": {"limit": [100, 80, 60, 50, 40], "free": [90, 70, 55, 45, 35], "lanes": [2, 2, 2, 1, 1]},
}
SMALL_WORDS = {"of", "the", "and", "to", "a", "an"}
R_EARTH = 6_371_008.8


def load_region(region_id: str) -> dict:
    return yaml.safe_load((ROOT / "config" / "regions" / f"{region_id}.yaml").read_text(encoding="utf-8"))


def haversine(lon1, lat1, lon2, lat2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp, dl = p2 - p1, np.radians(np.asarray(lon2) - np.asarray(lon1))
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * R_EARTH * np.arcsin(np.sqrt(a))


def simplify(points: list[tuple[float, float]], tol_m: float) -> list[tuple[float, float]]:
    """Douglas-Peucker in local metres; the ends always stay."""
    if len(points) <= 2 or tol_m <= 0:
        return points
    lat0 = math.radians(points[0][1])
    xy = np.array([(math.radians(x) * math.cos(lat0) * R_EARTH, math.radians(y) * R_EARTH) for x, y in points])
    keep = np.zeros(len(points), dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = xy[i], xy[j]
        seg = b - a
        n = np.hypot(*seg)
        pts = xy[i + 1 : j]
        if n == 0:
            d = np.hypot(*(pts - a).T)
        else:
            rel = pts - a
            d = np.abs(seg[0] * rel[:, 1] - seg[1] * rel[:, 0]) / n
        k = int(np.argmax(d))
        if d[k] > tol_m:
            keep[i + 1 + k] = True
            stack += [(i, i + 1 + k), (i + 1 + k, j)]
    return [p for p, k in zip(points, keep) if k]


def road_code(name: str, ref: str, prefer_ref: bool) -> str:
    r = re.sub(r"[^A-Za-z0-9]", "", ref.split(";")[0]).upper()
    words = [w for w in re.findall(r"[A-Za-z0-9]+", name) if w.lower() not in SMALL_WORDS]
    initials = "".join(w[0] for w in words).upper()[:6]
    if prefer_ref:
        return r or initials or "X"
    return initials or r or "X"


def build(region_id: str) -> dict:
    t0 = time.time()
    cfg = load_region(region_id)
    kind = cfg["kind"]
    with np.load(RAW / "india-roads.npz") as z:
        d = {k: z[k] for k in z.files}  # read each array once; an NpzFile re-reads on every access
    with gzip.open(RAW / "india-roads-meta.json.gz", "rt", encoding="utf-8") as f:
        meta = json.load(f)
    names, refs_txt, node_names = meta["names"], meta["refs"], meta["node_names"]
    node_id, lon, lat = d["node_id"], d["lon"], d["lat"]
    cls_arr, oneway_arr = d["cls"], d["oneway"]
    signal_set = set(d["signals"].tolist())
    w, s, e, n = cfg["bbox"]
    inside = (lon >= w) & (lon <= e) & (lat >= s) & (lat <= n) & ~np.isnan(lon)

    allowed = np.isin(cls_arr, [CLASSES.index(c) for c in cfg["road_classes"]])
    offsets, refs = d["offsets"], d["refs"]
    ref_idx = np.searchsorted(node_id, refs)
    ref_in = inside[ref_idx]
    touches = np.add.reduceat(ref_in.astype(np.int32), offsets[:-1]) > 0
    ways = np.nonzero(allowed & touches)[0]
    print(f"{region_id}: {len(ways):,} OSM ways in the box ({time.time() - t0:.0f} s)")

    # each way cut to the runs of its nodes inside the box
    runs: list[tuple[int, np.ndarray]] = []
    for wi in ways:
        a0, a1 = offsets[wi], offsets[wi + 1]
        idx, ok = ref_idx[a0:a1], ref_in[a0:a1]
        if ok.all():
            runs.append((int(wi), idx))
            continue
        breaks = np.flatnonzero(np.diff(ok.astype(np.int8))) + 1
        for part, pok in zip(np.split(idx, breaks), np.split(ok, breaks)):
            if pok[0] and len(part) >= 2:
                runs.append((int(wi), part))

    # junction candidates: nodes used more than once, and the ends of every run
    counts = np.bincount(np.concatenate([r for _, r in runs]), minlength=len(node_id))
    vertex = counts >= 2
    for _, r in runs:
        vertex[r[0]] = vertex[r[-1]] = True
    del counts

    # pieces: stretches of one way between two junction candidates
    pieces_raw: list[tuple[np.ndarray, int]] = []
    for wi, r in runs:
        cut = np.flatnonzero(vertex[r[1:-1]]) + 1
        bounds = [0, *cut.tolist(), len(r) - 1]
        for a, b in zip(bounds[:-1], bounds[1:]):
            if b > a:
                pieces_raw.append((r[a : b + 1], wi))
    del runs

    adj: dict[int, list[tuple[int, bool]]] = defaultdict(list)  # vertex -> [(piece, piece starts here)]
    for p, (seq, _) in enumerate(pieces_raw):
        adj[int(seq[0])].append((p, True))
        adj[int(seq[-1])].append((p, False))

    def key(wi: int):
        return (names[wi] or refs_txt[wi], int(cls_arr[wi]), int(oneway_arr[wi]))

    def is_split(v: int) -> bool:
        ends = adj[v]
        if len(ends) != 2 or ends[0][0] == ends[1][0]:
            return True
        return key(pieces_raw[ends[0][0]][1]) != key(pieces_raw[ends[1][0]][1])

    # merge pieces through vertices where one road simply continues
    used = np.zeros(len(pieces_raw), dtype=bool)
    chains: list[tuple[list[int], int, bool]] = []  # node sequence, way, first piece forward

    def walk(v0: int, p0: int, at_start: bool):
        seq0, wi0 = pieces_raw[p0]
        nodes = list(seq0 if at_start else seq0[::-1])
        used[p0] = True
        cur = nodes[-1]
        while not is_split(cur) and cur != v0:
            nxt = [(p, st) for (p, st) in adj[cur] if not used[p]]
            if not nxt:
                break
            p, st = nxt[0]
            seq, _ = pieces_raw[p]
            nodes.extend((seq if st else seq[::-1])[1:])
            used[p] = True
            cur = nodes[-1]
        chains.append(([int(x) for x in nodes], wi0, at_start))

    for v in [v for v in adj if is_split(v)]:
        for p, st in adj[v]:
            if not used[p]:
                walk(v, p, st)
    for p in np.flatnonzero(~used):  # closed loops with no junction on them
        if not used[p]:
            walk(int(pieces_raw[p][0][0]), int(p), True)
    del pieces_raw, adj
    print(f"{region_id}: {len(chains):,} road stretches between junctions ({time.time() - t0:.0f} s)")

    # one-way chains run in the direction of travel
    oriented = []
    for seq, wi, fwd in chains:
        ow = int(oneway_arr[wi])
        if (ow == 1 and not fwd) or (ow == -1 and fwd):
            seq = seq[::-1]
        oriented.append((seq, wi, ow != 0))
    del chains

    # cap the length: split long chains at the node nearest each equal share
    cap = cfg["max_segment_km"] * 1000
    pieces = []
    for seq, wi, oneway in oriented:
        x, y = lon[seq], lat[seq]
        step = haversine(x[:-1], y[:-1], x[1:], y[1:])
        total = float(step.sum())
        if total > cap and len(seq) > 2:
            parts = math.ceil(total / cap)
            cum = np.concatenate([[0], np.cumsum(step)])
            cuts = sorted({int(np.argmin(np.abs(cum - total * p / parts))) for p in range(1, parts)} - {0, len(seq) - 1})
            bounds = [0] + cuts + [len(seq) - 1]
            for a, b in zip(bounds[:-1], bounds[1:]):
                pieces.append((seq[a : b + 1], wi, oneway, float(step[a:b].sum())))
        else:
            pieces.append((seq, wi, oneway, total))

    # keep the largest connected piece of the network, so every junction can reach every other
    parent: dict[int, int] = {}

    def find(a):
        parent.setdefault(a, a)
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for seq, *_ in pieces:
        ra, rb = find(seq[0]), find(seq[-1])
        if ra != rb:
            parent[ra] = rb
    comp_len: dict[int, float] = defaultdict(float)
    for seq, _, _, length in pieces:
        comp_len[find(seq[0])] += length
    main = max(comp_len, key=comp_len.get)
    dropped = sum(v for k, v in comp_len.items() if k != main)
    pieces = [p for p in pieces if find(p[0][0]) == main and p[3] > 1.0]

    # junction ids, stable for one extract: ordered by OSM node id
    ends = sorted({p[0][0] for p in pieces} | {p[0][-1] for p in pieces}, key=lambda i: int(node_id[i]))
    nid = {i: f"{region_id}-N{k:05d}" for k, i in enumerate(ends, 1)}

    # road codes, unique per road name
    prefer_ref = kind == "national"
    code_of: dict[str, str] = {}
    used: dict[str, str] = {}
    for _, wi, _, _ in pieces:
        label = (refs_txt[wi] if prefer_ref else names[wi]) or names[wi] or refs_txt[wi]
        if label in code_of:
            continue
        base = road_code(names[wi], refs_txt[wi], prefer_ref)
        code, k = base, 2
        while code in used and used[code] != label:
            code, k = f"{base}{k}", k + 1
        used[code] = label
        code_of[label] = code

    defaults = DEFAULTS[kind]
    by_code: dict[str, list[int]] = defaultdict(list)
    segs = []
    for seq, wi, oneway, length in pieces:
        c = int(d["cls"][wi])
        label = (refs_txt[wi] if prefer_ref else names[wi]) or names[wi] or refs_txt[wi]
        limit = int(d["maxspeed"][wi]) or defaults["limit"][c]
        free = min(round(0.8 * limit), defaults["free"][c]) if d["maxspeed"][wi] else defaults["free"][c]
        digits = 5 if kind == "national" else 6  # 1 m is plenty for the country view
        pts = [(round(float(lon[i]), digits), round(float(lat[i]), digits)) for i in seq]
        display = names[wi] or (refs_txt[wi].split(";")[0] if refs_txt[wi] else f"Unnamed {CLASSES[c]} road")
        segs.append({
            "id": None,
            "name": display,
            "road_class": CLASSES[c],
            "from_node": nid[seq[0]],
            "to_node": nid[seq[-1]],
            "length_m": round(length, 1),
            "speed_limit_kph": limit,
            "free_flow_kph": free,
            "lanes": int(d["lanes"][wi]) or defaults["lanes"][c],
            "oneway": oneway,
            "signals": sum(1 for i in seq[1:-1] if int(node_id[i]) in signal_set),
            "osm_way": int(d["way_id"][wi]),
            "geometry": [list(p) for p in simplify(pts, cfg.get("simplify_m", 0))],
            "_code": code_of[label],
        })
        by_code[code_of[label]].append(len(segs) - 1)

    # number each road's segments along the road
    for code, members in by_code.items():
        mids = np.array([segs[i]["geometry"][len(segs[i]["geometry"]) // 2] for i in members])
        if len(members) > 1:
            centred = mids - mids.mean(axis=0)
            axis = np.linalg.svd(centred, full_matrices=False)[2][0]
            order = np.argsort(centred @ axis)
        else:
            order = [0]
        width = max(2, len(str(len(members))))
        for rank, j in enumerate(order, 1):
            segs[members[j]]["id"] = f"{region_id}-{code}-{rank:0{width}d}"
    for sg in segs:
        sg.pop("_code")

    # junction names: OSM's own, else the roads that meet there
    meets: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for sg in segs:
        for end in (sg["from_node"], sg["to_node"]):
            meets[end].append((CLASSES.index(sg["road_class"]), sg["name"]))
    nodes = []
    for i in ends:
        roads = []
        for _, nm in sorted(meets[nid[i]]):
            if nm not in roads and not nm.startswith("Unnamed"):
                roads.append(nm)
        own = node_names.get(str(int(node_id[i])))
        name = own or (" and ".join(roads[:2]) if roads else "Unnamed junction")
        nodes.append({"id": nid[i], "name": name, "lng": round(float(lon[i]), 6), "lat": round(float(lat[i]), 6), "roads": roads})

    xs = [p[0] for sg in segs for p in sg["geometry"]]
    ys = [p[1] for sg in segs for p in sg["geometry"]]
    network = {
        "region": {
            "id": region_id,
            "kind": kind,
            "name": cfg["name"],
            "bbox": [round(min(xs), 5), round(min(ys), 5), round(max(xs), 5), round(max(ys), 5)],
            "timezone": cfg.get("timezone", "Asia/Kolkata"),
            "probe_share": cfg["probe_share"],
        },
        "source": f"© OpenStreetMap contributors, ODbL. Geofabrik extract {meta['source']}",
        "nodes": nodes,
        "segments": segs,
    }
    km = sum(sg["length_m"] for sg in segs) / 1000
    print(
        f"{region_id}: {len(nodes):,} junctions, {len(segs):,} segments, {km:,.0f} km "
        f"({dropped / 1000:,.0f} km in disconnected pieces left out) in {time.time() - t0:.0f} s"
    )
    return network


def main(region_id: str) -> None:
    network = build(region_id)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{region_id}.json"
    path.write_text(json.dumps(network, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size / 1e6:.1f} MB)")
    # what the Condense stages need, small enough to ship in their image: one row per segment
    index = {
        "region": network["region"],
        "columns": ["id", "length_m", "free_flow_kph", "lanes", "oneway", "road_class", "from_node", "to_node"],
        "segments": [[s["id"], s["length_m"], s["free_flow_kph"], s["lanes"], s["oneway"], s["road_class"], s["from_node"], s["to_node"]] for s in network["segments"]],
    }
    ipath = OUT / f"{region_id}.index.json.gz"
    with gzip.open(ipath, "wt", encoding="utf-8") as f:
        json.dump(index, f, separators=(",", ":"))
    print(f"wrote {ipath.relative_to(ROOT)} ({ipath.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "blr")
