# Build plan

All times IST. The rules allow frontend work and documentation before the build window; the
backend and the Condense pipeline start at 00:00 on Saturday 28 November.

## Before the window

| When | Task | Done |
|---|---|---|
| Tue 24 Nov | Architecture, API and event contracts; frontend app on design fixtures | yes |
| By Thu 26 Nov | **Wait for the organizers' Condense invite before signing up** (announced on Discord, 24 Nov). Then sign up, one account per team member, never shared | |
| Thu 26 Nov | Environment check: sign in, confirm the workspace, run the sample pipeline, test topic access | |
| Thu 26 Nov | Note the team prefix, usage limits, custom transform languages and the external Kafka connection method from the starter kit; correct the **confirm** items in ARCHITECTURE.md | |
| Fri 27 Nov 21:30 | Kickoff webinar | |

## The 48 hours

| Hours | Goal | Proof it works |
|---|---|---|
| 0-4 | Road network from OpenStreetMap (osmnx, ODbL) for the fixture area. Seeded simulator producing `telemetry-raw` | Messages visible in the Condense subscribe tester |
| 4-8 | `validate-telemetry` deployed on Condense; rejected topic | Injected bad events land in `telemetry-rejected` with reasons |
| 8-12 | `segment-window` on Condense; API consumer, SQLite, REST snapshots, SSE | **First end-to-end run**: a simulated slowdown turns a segment red in the browser. Record it |
| 12-16 | Split and Alerts utilities for alerts; `incident-detector`; routes API with A* | Incident scenario raises an incident and reroutes |
| 16-22 | History backfill (7 simulated days through the same pipeline); rule baseline forecast; train and evaluate the model per horizon | MAE and RMSE beside persistence on held-out data |
| 22-30 | Analytics endpoints; system health metrics; unit, API and Kafka integration tests | Tests green; system page shows real throughput and latency |
| 30-36 | Failure drills: stop the consumer, drop the network, restart the API | UI recovers without a reload |
| 36-42 | README, architecture diagram export, write-up, declarations; make the repository public; LICENSE check | Repository opens in a private window |
| 42-46 | Demo video, 5 minutes at most: the scenario, input events, the pipeline running in Condense, the output topics, what the user sees; say which parts are simulated | Link opens for someone outside the team |
| 46-48 | Submit the form early, with the full commit SHA | Receipt email |

## Demo scenario (window)

1. Normal morning traffic, seed 2026. The map shows free-flowing roads and moving vehicles.
2. Start the "gradual build-up" scenario on Outer Ring Road east of Silk Board. The forecast flags
   the segment as at risk before its level changes.
3. The segment turns heavy, then severe; an alert arrives from the Split utility.
4. Start the "incident" scenario on the same corridor: a possible-blockage incident appears with its
   evidence.
5. Ask for a route from Silk Board Junction to Iblur Junction: Arterial avoids the corridor and
   shows the minutes saved against the usual route.
6. The system page shows the Condense stages, topic throughput and end-to-end latency.
