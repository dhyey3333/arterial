"""Validation and windowing on a two-segment network, without Kafka."""

import json
from datetime import datetime, timedelta, timezone

from pipeline.validate import Validator
from pipeline.window import SegmentWindows

NET = {
    "t": {
        "region": {"id": "t", "bbox": [77.0, 12.0, 77.1, 12.1], "probe_share": 1.0},
        "by_id": {
            "t-A-01": {"id": "t-A-01", "length_m": 1000, "free_flow_kph": 40, "lanes": 2, "oneway": False},
            "t-A-02": {"id": "t-A-02", "length_m": 500, "free_flow_kph": 40, "lanes": 1, "oneway": True},
        },
    }
}
T0 = datetime(2026, 11, 28, 4, 0, 0, tzinfo=timezone.utc)


def ev(i, seg="t-A-01", speed=35.0, ts=T0, **kw):
    e = {
        "schema": "arterial.telemetry.v1", "event_id": f"00000000-0000-4000-8000-{i:012d}", "vehicle_id": f"SIM-V-{i % 7:04d}",
        "vehicle_type": "car", "ts": ts.isoformat().replace("+00:00", "Z"), "lat": 12.05, "lng": 77.05, "speed_kph": speed,
        "heading_deg": 90.0, "region": "t", "road_segment_id": seg, "seq": i, "source": "simulated",
    }
    e.update(kw)
    return json.dumps(e)


def reason(outs):
    assert len(outs) == 1
    topic, _, value = outs[0]
    return topic, json.loads(value).get("reason")


def test_valid_event_passes():
    v = Validator(NET)
    topic, why = reason(v.process("t-A-01", ev(1), now=T0))
    assert topic.endswith("telemetry-valid") and why is None


def test_each_bad_kind_is_rejected_with_its_reason():
    v = Validator(NET)
    cases = {
        "invalid_json": "{nope",
        "missing_gps": ev(2, lat=None),
        "out_of_bounds": ev(3, lat=40.0),
        "unknown_segment": ev(4, seg="t-NOPE-01"),
        "speed_range": ev(5, speed=400),
        "future_timestamp": ev(6, ts=T0 + timedelta(minutes=10)),
        "unknown_region": ev(7, region="xx"),
        "schema": ev(8, vehicle_id="CAR-1"),
    }
    for want, raw in cases.items():
        topic, why = reason(v.process(None, raw, now=T0))
        assert topic.endswith("telemetry-rejected") and why == want, (want, why)


def test_duplicates_and_out_of_order():
    v = Validator(NET)
    v.process("t-A-01", ev(14), now=T0)
    assert reason(v.process("t-A-01", ev(14), now=T0))[1] == "duplicate"
    _, _, value = v.process("t-A-01", ev(7, event_id="00000000-0000-4000-8000-999999999999"), now=T0)[0]
    assert json.loads(value)["out_of_order"] is True  # same vehicle (14 % 7 == 7 % 7), lower seq


def test_window_closes_with_metrics_and_escalates_at_once():
    w = SegmentWindows(NET)
    for i in range(6):
        w.process("t-A-01", ev(i, speed=36.0, ts=T0 + timedelta(seconds=i)), now=T0)
    out = w.tick(now=T0 + timedelta(seconds=60))
    m = json.loads(out[0][2])
    assert m["level"] == "free" and m["vehicle_count"] == 6 and m["window_end"] == "2026-11-28T04:00:30Z"
    for i in range(6):
        w.process("t-A-01", ev(10 + i, speed=8.0, ts=T0 + timedelta(seconds=61 + i)), now=T0 + timedelta(seconds=61))
    m = json.loads(w.tick(now=T0 + timedelta(seconds=120))[0][2])
    assert m["level"] == "severe" and m["level_changed"] and m["previous_level"] == "free"


def test_level_drops_only_after_two_lower_windows():
    w = SegmentWindows(NET)
    levels = []
    for n, speed in enumerate([8.0, 36.0, 36.0]):
        base = T0 + timedelta(seconds=30 * n)
        for i in range(5):
            w.process("t-A-01", ev(100 * n + i, speed=speed, ts=base + timedelta(seconds=i)), now=base)
        levels.append(json.loads(w.tick(now=base + timedelta(seconds=50))[0][2])["level"])
    assert levels == ["severe", "severe", "free"]


def test_harmonic_mean_counts_a_stopped_vehicle_at_2_kph():
    w = SegmentWindows(NET)
    for i, s in enumerate([0.0, 40.0, 40.0]):
        w.process("t-A-01", ev(i, speed=s, ts=T0 + timedelta(seconds=i)), now=T0)
    m = json.loads(w.tick(now=T0 + timedelta(seconds=60))[0][2])
    assert abs(m["avg_speed_kph"] - 3 / (1 / 2 + 2 / 40)) < 0.1
