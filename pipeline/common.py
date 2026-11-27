"""Shared by every Arterial stage: settings from the environment, the region networks, Kafka clients.

Stages are plain Kafka consumers and producers (confluent-kafka). Each one is a class with a
`process(key, value)` method that returns the messages to send, so it can be tested without Kafka
and run the same way on Condense or on a laptop. Topic names come from TEAM_PREFIX unless a
TOPIC_* variable names one exactly.
"""

from __future__ import annotations

import json
import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable

import yaml

ROOT = Path(__file__).resolve().parents[1]
CONFIG = yaml.safe_load((ROOT / "pipeline" / "config" / "congestion.yaml").read_text(encoding="utf-8"))
PIPELINE_VERSION = "2026.11.28-1"

Out = tuple[str, str, str]  # topic, key, value


def load_env(path: Path = ROOT / ".env") -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def prefixed(name: str) -> str:
    """The team's Kafka ACLs allow topics and groups that start with TEAM_PREFIX (codeverse_)."""
    return os.environ.get("TEAM_PREFIX", "arterial_") + name


def topic(name: str) -> str:
    """telemetry-raw -> TOPIC_TELEMETRY_RAW if set, else <TEAM_PREFIX>telemetry-raw."""
    return os.environ.get("TOPIC_" + name.upper().replace("-", "_")) or prefixed(name)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def load_networks() -> dict[str, dict]:
    """Every region's segment index (data/networks/<id>.index.json.gz, written by the network builder)."""
    import gzip

    nets = {}
    for p in sorted((ROOT / "data" / "networks").glob("*.index.json.gz")):
        with gzip.open(p, "rt", encoding="utf-8") as f:
            idx = json.load(f)
        cols = idx["columns"]
        by_id = {row[0]: dict(zip(cols, row)) for row in idx["segments"]}
        nets[idx["region"]["id"]] = {"region": idx["region"], "by_id": by_id}
    return nets


def kafka_conf(client_id: str) -> dict:
    conf = {
        "bootstrap.servers": os.environ["KAFKA_BOOTSTRAP_SERVERS"],
        "security.protocol": os.environ.get("KAFKA_SECURITY_PROTOCOL", "SASL_SSL"),
        "client.id": client_id,
    }
    if os.environ.get("KAFKA_SASL_MECHANISM"):
        conf["sasl.mechanism"] = os.environ["KAFKA_SASL_MECHANISM"]
    if os.environ.get("KAFKA_USERNAME"):
        conf["sasl.username"] = os.environ["KAFKA_USERNAME"]
        conf["sasl.password"] = os.environ.get("KAFKA_PASSWORD", "")
    return conf


def run(stage: str, inputs: list[str], process: Callable[[str | None, str], Iterable[Out]], tick: Callable[[], Iterable[Out]] | None = None) -> None:
    """Consume `inputs`, send whatever `process` returns, and call `tick` about once a second."""
    from confluent_kafka import Consumer, Producer

    load_env()
    group = os.environ.get("KAFKA_GROUP") or prefixed(stage)
    consumer = Consumer({
        **kafka_conf(f"arterial-{stage}"),
        "group.id": group,
        "auto.offset.reset": os.environ.get("KAFKA_OFFSET_RESET", "latest"),
        "enable.auto.commit": True,
    })
    producer = Producer({**kafka_conf(f"arterial-{stage}"), "linger.ms": 20, "compression.type": "lz4"})
    consumer.subscribe(inputs)
    print(f"{stage}: {inputs} as group {group}", file=sys.stderr)

    stop = False

    def _stop(*_):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)
    seen = sent = 0
    last_tick = last_log = time.monotonic()

    def emit(outs: Iterable[Out]) -> None:
        nonlocal sent
        for t, k, v in outs:
            while True:
                try:
                    producer.produce(t, key=k.encode() if k else None, value=v.encode())
                    break
                except BufferError:
                    producer.poll(0.2)
            sent += 1
        producer.poll(0)

    while not stop:
        msg = consumer.poll(0.5)
        if msg is not None:
            if msg.error():
                print(f"{stage}: {msg.error()}", file=sys.stderr)
            else:
                seen += 1
                key = msg.key().decode() if msg.key() else None
                emit(process(key, msg.value().decode("utf-8", errors="replace")))
        now = time.monotonic()
        if tick and now - last_tick >= 1:
            emit(tick())
            last_tick = now
        if now - last_log >= 15:
            print(f"{stage}: read {seen:,}, sent {sent:,}", file=sys.stderr)
            last_log = now
    producer.flush(10)
    consumer.close()
