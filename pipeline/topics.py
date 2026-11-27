"""Check the Kafka login and create Arterial's topics if they are missing.

The team's ACLs allow every operation on topics and groups that start with TEAM_PREFIX, so the
topics are created here rather than by hand. Re-running is safe: existing topics are left alone.

usage: python -m pipeline.topics
"""

from __future__ import annotations

import sys

from confluent_kafka.admin import AdminClient, NewTopic

from pipeline.common import kafka_conf, load_env, topic

DAY_MS = 24 * 3600 * 1000
TOPICS = {
    "telemetry-raw": DAY_MS,
    "telemetry-valid": DAY_MS,
    "telemetry-rejected": DAY_MS,
    "segment-metrics": 7 * DAY_MS,
    "congestion-alerts": 7 * DAY_MS,
    "incidents": 7 * DAY_MS,
    "predictions": 7 * DAY_MS,
}
PARTITIONS = 3


def main() -> None:
    load_env()
    admin = AdminClient(kafka_conf("arterial-admin"))
    meta = admin.list_topics(timeout=15)
    brokers = len(meta.brokers)
    print(f"connected: {brokers} brokers")
    names = {topic(t): ms for t, ms in TOPICS.items()}
    have = set(meta.topics)
    missing = [n for n in names if n not in have]
    for n in names:
        if n in have:
            print(f"exists  {n} ({len(meta.topics[n].partitions)} partitions)")
    if missing:
        new = [NewTopic(n, num_partitions=PARTITIONS, replication_factor=min(2, brokers), config={"retention.ms": str(names[n])}) for n in missing]
        for n, fut in admin.create_topics(new, request_timeout=30).items():
            try:
                fut.result()
                print(f"created {n}")
            except Exception as e:  # report every topic, then fail
                print(f"FAILED  {n}: {e}", file=sys.stderr)
                sys.exit(1)


if __name__ == "__main__":
    main()
