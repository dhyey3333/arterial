"""Arterial API v1 (docs/API.md): REST snapshots and a Server-Sent Events stream, built from the
team's Condense Kafka topics. One process serves one region (ARTERIAL_REGION, default `in`).

usage: python -m uvicorn api.main:app --port 8000
"""

from __future__ import annotations

import asyncio
import json
import os
import statistics
import time
import uuid
from collections import Counter, deque
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse

from api import kafka_worker
from api.routing import Router
from api.state import LEVELS, State, iso, parse
from pipeline.common import load_env

load_env()
REGION = os.environ.get("ARTERIAL_REGION", "in")
state = State(REGION)
router = Router(state)
IST = timezone(timedelta(hours=5, minutes=30))

app = FastAPI(title="Arterial API", version="1")
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("API_CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message, "request_id": uuid.uuid4().hex[:12]}}, status_code=status)


# ---------- stream ----------

class Hub:
    def __init__(self):
        self.clients: set[asyncio.Queue] = set()
        self.buffer: deque = deque()  # (id, time, type, json) for two minutes of replay
        self.next_id = 1
        self.loop: asyncio.AbstractEventLoop | None = None

    def publish(self, kind: str, payload) -> None:
        data = json.dumps(payload, separators=(",", ":"))
        eid = self.next_id
        self.next_id += 1
        now = time.time()
        self.buffer.append((eid, now, kind, data))
        while self.buffer and now - self.buffer[0][1] > 120:
            self.buffer.popleft()
        frame = f"id: {eid}\nevent: {kind}\ndata: {data}\n\n"
        for q in list(self.clients):
            if q.qsize() < 500:
                q.put_nowait(frame)

    def publish_threadsafe(self, kind: str, payload) -> None:
        if self.loop:
            self.loop.call_soon_threadsafe(self.publish, kind, payload)


hub = Hub()
state.listeners.append(hub.publish_threadsafe)


async def ticker():
    n = 0
    while True:
        await asyncio.sleep(1)
        n += 1
        hub.publish("vehicles", {"ts": iso(), "vehicles": state.vehicle_sample()})
        if n % 2 == 0:
            pending = state.take_pending()
            if pending:
                hub.publish("segments", {"window_end": state.current_window, "states": pending})
            hub.publish("system", state.system())
        if n % 5 == 0:
            hub.publish("summary", state.summary())
        if n % 10 == 0:
            hub.publish("heartbeat", {"ts": iso()})
            sysd = state.system()
            state.throughput.append({"ts": iso(), "in_per_s": sysd["throughput"]["in_per_s"], "out_per_s": sysd["throughput"]["out_per_s"], "p95_ms": sysd["latency_ms"]["p95"]})
        if n % 30 == 0 and state.predictions:
            hub.publish("predictions", prediction_set())


@app.on_event("startup")
async def startup():
    hub.loop = asyncio.get_running_loop()
    kafka_worker.start(state)
    asyncio.create_task(ticker())


@app.get("/api/v1/stream")
async def stream(request: Request, last_event_id: int | None = None):
    last = request.headers.get("last-event-id") or last_event_id
    q: asyncio.Queue = asyncio.Queue()
    if last is not None:
        last = int(last)
        if hub.buffer and last >= hub.buffer[0][0] - 1:
            for eid, _, kind, data in hub.buffer:
                if eid > last:
                    q.put_nowait(f"id: {eid}\nevent: {kind}\ndata: {data}\n\n")
        else:
            q.put_nowait(f"event: resync\ndata: {{}}\n\n")
    hub.clients.add(q)

    async def gen():
        try:
            yield "retry: 3000\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    yield await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            hub.clients.discard(q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------- network and traffic ----------

@app.get("/api/v1/network")
def network(request: Request):
    if "gzip" in request.headers.get("accept-encoding", ""):
        return Response(state.network_gz, media_type="application/json", headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
    return Response(state.network_json, media_type="application/json")


@app.get("/api/v1/places")
def places(q: str = "", limit: int = 8):
    return {"query": q, "region": REGION, "places": router.places(q, max(1, min(limit, 20)))}


@app.get("/api/v1/traffic/segments")
def segments():
    return {"as_of": iso(), "window_s": 30, "states": state.fresh_states()}


@app.get("/api/v1/traffic/segments/{segment_id}")
def segment(segment_id: str, minutes: int = 60):
    seg = state.segments.get(segment_id)
    if not seg:
        return error(404, "unknown_segment", f"No segment {segment_id} in {REGION}.")
    cutoff = iso(datetime.now(timezone.utc) - timedelta(minutes=minutes))
    hist = [h for h in state.history.get(segment_id, ()) if h["window_end"] >= cutoff]
    fresh = {s["segment_id"]: s for s in state.fresh_states()}
    preds = [p for (sid, _), p in state.predictions.items() if sid == segment_id]
    incs = [i for i in state.incidents.values() if i["segment_id"] == segment_id]
    public = {k: seg[k] for k in ("id", "name", "road_class", "from_node", "to_node", "length_m", "speed_limit_kph", "free_flow_kph", "lanes", "geometry")}
    return {"segment": public, "state": fresh.get(segment_id), "history": hist, "predictions": preds, "incidents": incs}


@app.get("/api/v1/traffic/summary")
def summary():
    return state.summary()


@app.get("/api/v1/traffic/history")
def history(minutes: int = 60):
    minutes = max(1, min(minutes, 1440))
    cutoff = iso(datetime.now(timezone.utc) - timedelta(minutes=minutes))
    return {"minutes": minutes, "points": [p for p in state.points if p["ts"] >= cutoff], "comparison": {"label": "Same time one simulated day earlier", "points": []}}


@app.get("/api/v1/alerts")
def alerts(status: str = "active", limit: int = 50):
    return {"alerts": list(state.alerts)[: max(1, min(limit, 500))]}


@app.get("/api/v1/incidents")
def incidents(status: str = "active", limit: int = 100):
    items = list(state.incidents.values())
    if status in ("active", "resolved"):
        items = [i for i in items if i.get("status") == status]
    return {"incidents": items[:limit]}


@app.get("/api/v1/incidents/{incident_id}")
def incident(incident_id: str):
    inc = state.incidents.get(incident_id)
    return inc if inc else error(404, "unknown_incident", f"No incident {incident_id}.")


def prediction_set() -> dict:
    preds = list(state.predictions.values())
    return {"made_at": state.predictions_made_at or iso(), "horizons": [5, 10, 15], "model": MODEL_PENDING, "predictions": preds}


MODEL_PENDING = {
    "name": "congestion-forecast", "version": "0", "region": REGION, "kind": "rule_baseline",
    "description": "The forecast stage is not running yet; no predictions are shown until it publishes.",
    "trained_at": None, "training_windows": 0, "evaluated_at": None, "evaluation": [],
}


@app.get("/api/v1/predictions")
def predictions(horizon: int | None = None):
    if not state.predictions:
        return error(503, "not_running", "The forecast stage has not published any predictions yet.")
    ps = prediction_set()
    if horizon:
        ps["predictions"] = [p for p in ps["predictions"] if p["horizon_min"] == horizon]
    return ps


@app.get("/api/v1/predictions/model")
def model():
    return MODEL_PENDING


@app.post("/api/v1/routes")
async def routes(request: Request):
    try:
        body = await request.json()
        origin, dest = body["origin"], body["destination"]
    except (ValueError, KeyError, TypeError):
        return error(400, "bad_request", "Send {\"origin\": node id, \"destination\": node id}.")
    for n in (origin, dest):
        if n not in state.nodes:
            return error(404, "unknown_node", f"No junction {n} in {REGION}.")
    if origin == dest:
        return error(400, "same_place", "Origin and destination are the same junction.")
    res = await asyncio.to_thread(router.route, origin, dest)
    return res if res else error(404, "no_route", "These two junctions are not connected on this network.")


# ---------- analytics, from the windows this API has seen ----------

@app.get("/api/v1/analytics/overview")
def analytics(days: int = 7):
    pts = list(state.points)
    if len(pts) < 4:
        return error(503, "not_enough_history", "Analytics need a few closed windows; try again in a couple of minutes.")
    by_hour: dict[int, list] = {}
    for p in pts:
        by_hour.setdefault(parse(p["ts"]).astimezone(IST).hour, []).append(p)
    hourly = []
    for h in range(24):
        ps = by_hour.get(h, [])
        speeds = [p["avg_speed_kph"] for p in ps if p["avg_speed_kph"] is not None]
        hourly.append({
            "hour": h,
            "avg_speed_kph": round(statistics.mean(speeds), 1) if speeds else None,
            "congested_share": round(statistics.mean(p["congested_km"] / state.network_km for p in ps), 4) if ps else 0,
            "vehicles": round(statistics.mean(p["vehicles"] for p in ps)) if ps else 0,
        })
    seg_rows, heat = [], []
    for sid, hist in state.history.items():
        speeds = sorted(h["avg_speed_kph"] for h in hist if h["avg_speed_kph"] is not None)
        if len(speeds) < 2:
            continue
        cong = [h for h in hist if h["level"] in ("heavy", "severe")]
        episodes = sum(1 for a, b in zip(hist, list(hist)[1:]) if b["level"] in ("heavy", "severe") and a["level"] not in ("heavy", "severe"))
        p15 = speeds[max(0, int(0.15 * len(speeds)) - 1)]
        vff = state.segments[sid]["free_flow_kph"]
        seg_rows.append({
            "segment_id": sid, "avg_speed_kph": round(statistics.mean(speeds), 1), "p15_speed_kph": round(p15, 1),
            "congested_minutes": round(len(cong) * 0.5, 1), "congestion_episodes": episodes, "incidents": 0,
            "reliability": round(min(1.0, p15 / vff), 3),
        })
        per_hour = Counter(parse(h["window_end"]).astimezone(IST).hour for h in hist)
        cong_hour = Counter(parse(h["window_end"]).astimezone(IST).hour for h in cong)
        for hr, n in per_hour.items():
            heat.append({"segment_id": sid, "hour": hr, "congested_share": round(cong_hour.get(hr, 0) / n, 3)})
    seg_rows.sort(key=lambda r: -r["congested_minutes"])
    top = {r["segment_id"] for r in seg_rows[:20]}
    peaks = [h["hour"] for h in sorted(hourly, key=lambda x: -x["congested_share"]) if h["congested_share"] > 0][:2]
    span_h = (parse(pts[-1]["ts"]) - parse(pts[0]["ts"])).total_seconds() / 3600
    return {
        "from": pts[0]["ts"], "to": pts[-1]["ts"], "simulated_days": round(span_h / 24, 2),
        "hourly": hourly, "peak_hours": peaks,
        "heat": [x for x in heat if x["segment_id"] in top],
        "segments": seg_rows[:50],
        "flow": [{"ts": p["ts"], "flow_veh_per_h": p["flow_veh_per_h"], "avg_speed_kph": p["avg_speed_kph"], "vehicles": p["vehicles"]} for p in pts[-120:]],
    }


# ---------- system ----------

@app.get("/api/v1/system/status")
def system():
    return state.system()


@app.get("/api/v1/system/throughput")
def throughput(minutes: int = 15):
    cutoff = iso(datetime.now(timezone.utc) - timedelta(minutes=minutes))
    return {"points": [p for p in state.throughput if p["ts"] >= cutoff]}


@app.get("/api/v1/health")
def health():
    return {"ok": True, "region": REGION, "kafka": state.kafka["connected"], "segments_with_data": len(state.fresh_states())}
