"""Read the Geofabrik India extract once and keep only the roads Arterial can use.

Two passes over the .osm.pbf, filtered in C++ by pyosmium so only matching objects reach Python:
  1. ways tagged highway=motorway..tertiary (and their _link ramps): tags and node references;
  2. the nodes those ways use: location, plus a name when the node has one.
The result is a compact cache in data/raw/ that network.py cuts into regions in seconds.

usage: python -m simulator.osm_extract [path/to/india-latest.osm.pbf]
"""

from __future__ import annotations

import gzip
import json
import re
import sys
import time
from array import array
from pathlib import Path

import numpy as np
import osmium

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
CACHE = RAW / "india-roads.npz"
META = RAW / "india-roads-meta.json.gz"

# road classes in rank order; a ramp takes the class of the road it serves
CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary"]
HIGHWAY = {c: i for i, c in enumerate(CLASSES)}
HIGHWAY.update({f"{c}_link": i for i, c in enumerate(CLASSES)})


def _speed(tag: str | None) -> int:
    """maxspeed as km/h, 0 when missing or not a plain number (mph is converted)."""
    if not tag:
        return 0
    m = re.match(r"\s*(\d+(?:\.\d+)?)\s*(mph)?", tag)
    if not m:
        return 0
    v = float(m.group(1)) * (1.609 if m.group(2) else 1.0)
    return int(round(v)) if 5 <= v <= 150 else 0


def _lanes(tag: str | None) -> int:
    m = re.match(r"\s*(\d+)", tag or "")
    n = int(m.group(1)) if m else 0
    return n if 1 <= n <= 12 else 0


def _oneway(tags) -> int:
    """1 forward only, -1 backward only, 0 both ways. Motorways and roundabouts are one way."""
    v = tags.get("oneway")
    if v in ("yes", "true", "1"):
        return 1
    if v in ("-1", "reverse"):
        return -1
    if v == "no":
        return 0
    if tags.get("highway") in ("motorway", "motorway_link") or tags.get("junction") == "roundabout":
        return 1
    return 0


def read_ways(pbf: Path):
    flt = osmium.filter.TagFilter(*[("highway", h) for h in HIGHWAY])
    way_id = array("q")
    cls = array("b")
    oneway = array("b")
    maxspeed = array("h")
    lanes = array("b")
    link = array("b")
    offsets = array("q", [0])
    refs = array("q")
    names: list[str] = []
    road_refs: list[str] = []
    for w in osmium.FileProcessor(str(pbf), osmium.osm.WAY).with_filter(flt):
        nodes = [n.ref for n in w.nodes]
        if len(nodes) < 2:
            continue
        t = w.tags
        hw = t.get("highway")
        way_id.append(w.id)
        cls.append(HIGHWAY[hw])
        link.append(1 if hw.endswith("_link") else 0)
        oneway.append(_oneway(t))
        maxspeed.append(_speed(t.get("maxspeed")))
        lanes.append(_lanes(t.get("lanes")))
        names.append(t.get("name:en") or t.get("name") or "")
        road_refs.append(t.get("ref") or "")
        refs.extend(nodes)
        offsets.append(len(refs))
    return dict(
        way_id=np.frombuffer(way_id, dtype=np.int64),
        cls=np.frombuffer(cls, dtype=np.int8),
        link=np.frombuffer(link, dtype=np.int8),
        oneway=np.frombuffer(oneway, dtype=np.int8),
        maxspeed=np.frombuffer(maxspeed, dtype=np.int16),
        lanes=np.frombuffer(lanes, dtype=np.int8),
        offsets=np.frombuffer(offsets, dtype=np.int64),
        refs=np.frombuffer(refs, dtype=np.int64),
    ), names, road_refs


def read_nodes(pbf: Path, wanted: np.ndarray):
    lon = np.full(len(wanted), np.nan)
    lat = np.full(len(wanted), np.nan)
    node_names: dict[str, str] = {}
    signals = array("q")
    flt = osmium.filter.IdFilter(wanted.tolist())
    for n in osmium.FileProcessor(str(pbf), osmium.osm.NODE).with_filter(flt):
        i = int(np.searchsorted(wanted, n.id))
        loc = n.location
        lon[i] = loc.lon
        lat[i] = loc.lat
        t = n.tags
        name = t.get("name:en") or t.get("name")
        if name:
            node_names[str(n.id)] = name
        if t.get("highway") == "traffic_signals":
            signals.append(n.id)
    return lon, lat, node_names, np.frombuffer(signals, dtype=np.int64)


def main(pbf: Path) -> None:
    t0 = time.time()
    ways, names, road_refs = read_ways(pbf)
    print(f"ways: {len(ways['way_id']):,} with {len(ways['refs']):,} node references ({time.time() - t0:.0f} s)")
    wanted = np.unique(ways["refs"])
    lon, lat, node_names, signals = read_nodes(pbf, wanted)
    missing = int(np.isnan(lon).sum())
    print(f"nodes: {len(wanted):,}, {missing:,} without a location, {len(node_names):,} named ({time.time() - t0:.0f} s)")
    RAW.mkdir(parents=True, exist_ok=True)
    np.savez(CACHE, node_id=wanted, lon=lon, lat=lat, signals=signals, **ways)
    with gzip.open(META, "wt", encoding="utf-8") as f:
        json.dump({"source": pbf.name, "classes": CLASSES, "names": names, "refs": road_refs, "node_names": node_names}, f)
    print(f"wrote {CACHE.name} and {META.name} ({time.time() - t0:.0f} s)")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else RAW / "india-latest.osm.pbf")
