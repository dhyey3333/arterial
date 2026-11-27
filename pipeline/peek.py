"""Read a few seconds of the team's topics and summarise them: proof that data is flowing.

usage: python -m pipeline.peek [seconds]
"""

from __future__ import annotations

import collections
import json
import sys
import time
import uuid

from confluent_kafka import Consumer

from pipeline.common import kafka_conf, load_env, prefixed, topic

NAMES = ["telemetry-raw", "telemetry-valid", "telemetry-rejected", "segment-metrics", "congestion-alerts", "incidents", "predictions"]


def main() -> None:
    load_env()
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 45
    c = Consumer({**kafka_conf("arterial-peek"), "group.id": prefixed(f"peek-{uuid.uuid4().hex[:6]}"), "auto.offset.reset": "latest", "enable.auto.commit": False})
    c.subscribe([topic(n) for n in NAMES])
    counts = collections.Counter()
    levels = collections.Counter()
    reasons = collections.Counter()
    regions = collections.Counter()
    sample = None
    end = time.time() + seconds
    while time.time() < end:
        m = c.poll(0.5)
        if m is None or m.error():
            continue
        t = m.topic()
        counts[t] += 1
        if t == topic("segment-metrics"):
            v = json.loads(m.value())
            levels[v["level"]] += 1
            regions[v.get("region")] += 1
            if sample is None or v["level"] in ("heavy", "severe"):
                sample = v
        elif t == topic("telemetry-rejected"):
            reasons[json.loads(m.value())["reason"]] += 1
    c.close()
    print(f"in {seconds:.0f} s:")
    for n in NAMES:
        print(f"  {topic(n):32s} {counts[topic(n)]:>7,}")
    if reasons:
        print("  rejected by reason:", dict(reasons))
    if levels:
        print("  window levels:", dict(levels), "by region:", dict(regions))
    if sample:
        print("  e.g.", sample["segment_id"], sample["level"], "-", sample["reason"])


if __name__ == "__main__":
    main()
