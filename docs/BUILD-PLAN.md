# Build plan

All times IST. The rules allow frontend work and documentation before the build window; the
backend and the Condense pipeline start at 00:00 on Saturday 28 November.

## Before the window

| When | Task | Done |
|---|---|---|
| Tue 24 Nov | Architecture, API and event contracts; frontend app on design fixtures | yes |
| Wed 25 Nov | Region design in the docs: a national tier for all of India and city tiers in detail; region configs, network builder, ids, place search (ARCHITECTURE.md section 2.1) | yes |
| Wed 25 Nov | Frontend: the region's name from `/network` in the console header; no default junction ids on the Routes page; place search (`/places`, served by the fixtures until the API exists); the console map fits whatever network it is given; landing copy that doesn't promise 21 segments; the landing's roads drawn in a real night city (OpenStreetMap through OpenFreeMap) | yes |
| By Thu 26 Nov | **Wait for the organizers' Condense invite before signing up** (announced on Discord, 24 Nov). Then sign up, one account per team member, never shared | yes, 27 Nov |
| Thu 26 Nov | Environment check: sign in, confirm the workspace, run the sample pipeline, test topic access | signed in; workspace Codeverse confirmed (ARCHITECTURE.md section 3.1). The sample pipeline and topic access wait for a broker connection from the organizers |
| Thu 26 Nov | Note the team prefix, usage limits, custom transform languages and the external Kafka connection method from the starter kit; correct the **confirm** items in ARCHITECTURE.md | languages and connection method done; prefix, usage limits and the Kafka broker login still to come from the organizers |
| Fri 27 Nov 21:30 | Kickoff webinar | |

## The 48 hours

| Hours | Goal | Proof it works |
|---|---|---|
| 0-4 | Region config and network builder (osmnx, ODbL): Bengaluru's main roads. Start the India extract download (1.6 GB) in the background. Seeded simulator producing `telemetry-raw` for `ARTERIAL_REGION=blr` | Builder prints node and segment counts; messages visible in the Condense subscribe tester |
| 4-8 | `validate-telemetry` deployed on Condense; rejected topic | Injected bad events land in `telemetry-rejected` with reasons |
| 8-12 | `segment-window` on Condense; API consumer, SQLite, REST snapshots, SSE | **First end-to-end run**: a simulated slowdown turns a segment red in the browser. Record it |
| 12-16 | Split and Alerts utilities for alerts (or `alert-router` if the canvas has neither); `incident-detector`; routes API with A* over the whole region network; place search | Incident scenario raises an incident and reroutes; two junctions picked at random route |
| 16-22 | History backfill (7 simulated days through the same pipeline); rule baseline forecast; train and evaluate the model per horizon | MAE and RMSE beside persistence on held-out data |
| 22-30 | Analytics endpoints; system health metrics; unit, API and Kafka integration tests | Tests green; system page shows real throughput and latency |
| 30-36 | National tier: filter the India extract to expressways and national highways, build the network and the place gazetteer, run region `in` through the same pipeline at a 5% probe share, with no code change | Highways across the country colour from Condense windows; a route between two towns far apart works; the total event rate stays inside the usage limits. Record it |
| 36-38 | Failure drills: stop the consumer, drop the network, restart the API | UI recovers without a reload |
| 38-42 | README, architecture diagram export, write-up, declarations; make the repository public; LICENSE check | Repository opens in a private window |
| 42-46 | Demo video, 5 minutes at most: the scenario, input events, the pipeline running in Condense, the output topics, what the user sees; say which parts are simulated | Link opens for someone outside the team |
| 46-48 | Submit the form early, with the full commit SHA | Receipt email |

**The national tier comes after the core, never instead of it.** Bengaluru must work end to end
(hours 0-30) first: that is what the Condense, completeness and mobility scores rest on.

- **If the whole country is too heavy** for the usage limits or the browser: run one Geofabrik zone
  instead (the Southern Zone extract is 534 MB and covers Bengaluru), and say so.
- **If behind at hour 30:** skip the national tier and spend the time on the core. The write-up then
  says the code takes a region setting but only Bengaluru was run, and does not claim the country.

**Stretch, only if everything above is done:** a second detailed city; one route that joins a
city's streets to the national highways.

## Demo scenario (window)

1. Normal morning traffic, seed 2026. The map shows free-flowing roads and moving vehicles.
2. Start the "gradual build-up" scenario on Outer Ring Road east of Silk Board. The forecast flags
   the segment as at risk before its level changes.
3. The segment turns heavy, then severe; an alert arrives through the alert routing stage.
4. Start the "incident" scenario on the same corridor: a possible-blockage incident appears with its
   evidence.
5. Type "Silk Board" and "Iblur" into the route search: Arterial avoids the corridor and shows the
   minutes saved against the usual route.
6. The system page shows the Condense stages, topic throughput and end-to-end latency.
7. Zoom out to India: the national tier, on the same pipeline. Start an incident on a national
   highway, then search two towns on either side of it: Arterial routes around it and shows the
   time saved. About 40 seconds of the video.
