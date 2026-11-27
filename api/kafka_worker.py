"""Reads the team's topics into State, on its own threads.

Live topics (raw, valid, rejected) start at the end; segment-metrics, alerts, incidents and
predictions start ten minutes back, so a restarted API has a picture at once. Offsets are not
committed: every start rebuilds from Kafka, so the API holds no state Kafka does not.
"""

from __future__ import annotations

import json
import sys
import threading
import time
from datetime import datetime, timezone

from confluent_kafka import OFFSET_END, Consumer, KafkaException, TopicPartition
from confluent_kafka.admin import AdminClient
from confluent_kafka import ConsumerGroupTopicPartitions

from api.state import State, iso
from pipeline.common import kafka_conf, prefixed, topic

REPLAY_S = 600


def start(state: State) -> None:
    threading.Thread(target=_consume, args=(state,), daemon=True, name="kafka-consume").start()
    threading.Thread(target=_watch_lag, args=(state,), daemon=True, name="kafka-lag").start()


def _consume(state: State) -> None:
    handlers = {
        topic("telemetry-raw"): state.on_raw,
        topic("telemetry-valid"): state.on_valid,
        topic("telemetry-rejected"): state.on_rejected,
        topic("segment-metrics"): state.on_metric,
        topic("congestion-alerts"): state.on_alert,
        topic("incidents"): state.on_incident,
        topic("predictions"): state.on_prediction,
    }
    replay = {topic(n) for n in ("segment-metrics", "congestion-alerts", "incidents", "predictions")}
    conf = kafka_conf("arterial-api")
    state.kafka["bootstrap_host"] = conf["bootstrap.servers"].split(",")[0].split(":")[0]
    while True:
        try:
            c = Consumer({**conf, "group.id": prefixed("api"), "enable.auto.commit": False, "auto.offset.reset": "latest"})
            meta = c.list_topics(timeout=15)
            since = int((time.time() - REPLAY_S) * 1000)
            parts = []
            for name in handlers:
                if name not in meta.topics:
                    continue
                for p in meta.topics[name].partitions:
                    parts.append(TopicPartition(name, p, since if name in replay else OFFSET_END))
            timed = [tp for tp in parts if tp.offset == since]
            if timed:
                found = {(tp.topic, tp.partition): tp.offset for tp in c.offsets_for_times(timed, timeout=15)}
                for tp in parts:
                    if (tp.topic, tp.partition) in found:
                        off = found[(tp.topic, tp.partition)]
                        tp.offset = off if off >= 0 else OFFSET_END
            c.assign(parts)
            state.kafka.update(connected=True, last_error=None)
            print(f"api: reading {len(parts)} partitions", file=sys.stderr)
            while True:
                msg = c.poll(0.5)
                if msg is None:
                    continue
                if msg.error():
                    state.consumer_errors += 1
                    state.kafka["last_error"] = str(msg.error())
                    continue
                try:
                    handlers[msg.topic()](json.loads(msg.value()))
                except (ValueError, KeyError, TypeError) as e:
                    state.consumer_errors += 1
                    state.kafka["last_error"] = f"{msg.topic()}: {e}"
        except KafkaException as e:
            state.kafka.update(connected=False, last_error=str(e))
            state.kafka["reconnects"] += 1
            print(f"api: kafka error {e}, retrying", file=sys.stderr)
            time.sleep(5)


def _watch_lag(state: State) -> None:
    """Consumer lag of the Condense transforms' groups: how far each is behind its input topic."""
    groups = {prefixed("validate-telemetry"): topic("telemetry-raw"), prefixed("segment-window"): topic("telemetry-valid")}
    conf = kafka_conf("arterial-api-lag")
    admin = AdminClient(conf)
    probe = Consumer({**conf, "group.id": prefixed("api-lag"), "enable.auto.commit": False})
    while True:
        for group, tname in groups.items():
            try:
                fut = admin.list_consumer_group_offsets([ConsumerGroupTopicPartitions(group)], request_timeout=10)[group]
                committed = {tp.partition: tp.offset for tp in fut.result().topic_partitions if tp.topic == tname}
                lag, newest = 0, None
                for p, off in committed.items():
                    lo, hi = probe.get_watermark_offsets(TopicPartition(tname, p), timeout=10)
                    lag += max(0, hi - max(off, lo))
                state.lags[group] = {
                    "group": group,
                    "topic": tname,
                    "lag": lag,
                    "status": "unknown" if not committed else "ok" if lag < 5000 else "degraded",
                    "last_commit_at": iso() if committed else None,
                }
            except Exception as e:  # one group failing must not stop the others
                state.lags[group] = {"group": group, "topic": tname, "lag": 0, "status": "unknown", "last_commit_at": None}
                state.kafka["last_error"] = f"lag {group}: {e}"
        time.sleep(15)
