# Arterial: write-up

Configure 2026, team Codeverse. Built in the 48-hour window, 28 to 29 November 2026.

## For the form

- **Title:** Arterial
- **One line:** Real-time traffic intelligence on Condense that forecasts where a jam forms in the
  next 15 minutes, across all of India.
- **Target user:** a city traffic control room (Bengaluru first), with highway control rooms and
  fleet operators next.
- **Mobility problem:** operators see congestion only once roads are already red. By then the queue
  has spread and rerouting comes too late. Arterial rates every road segment every 30 seconds and
  forecasts which ones slow in the next 5, 10 and 15 minutes, so the operator acts before the jam forms.

## The problem

A control room watching Outer Ring Road at Silk Board learns about a jam when the road turns red.
By then traffic is backed up onto the roads that feed it, and any rerouting or signal change works
against a queue that is already there. The useful question is a step earlier: which roads are about
to slow, by how much, and why.

## The solution

Simulated vehicles drive the real road network of India from OpenStreetMap and report their
position and speed every 5 seconds. On Condense, four stages turn that stream into what an operator
needs:

1. **Validate**: every event is checked: schema, missing GPS, impossible coordinates, speed range,
   unknown road, duplicates, events from the future. Bad events go to their own topic with the reason.
   The simulator sends 2% bad events on purpose, so this path is always exercised.
2. **Segment windows**: every 30 seconds, each road segment gets its space-mean speed, density,
   flow, severity, trend and a congestion level (free, moderate, heavy, severe). Levels escalate at
   once but drop only after two calmer windows, so they do not flicker.
3. **Forecast**: each segment's speed 5, 10 and 15 minutes ahead, from the recent trend and the
   density rising on the roads that feed it, with an interval and a risk score. Every forecast is
   checked against what actually happened when its target time arrives, beside a "speed stays the
   same" baseline. The interval comes from those live errors.
4. **Alerts**: a road turning heavy or severe, worsening to severe, staying severe for 2 minutes, or
   clearing.

The API reads the results from Kafka and streams them to the web app. The console shows the whole
country live: the map, levels, forecasts, alerts, routes that avoid congestion (A* over current speeds,
compared with the usual route) and the pipeline's own health. The landing page plays the forecast on
21 Bengaluru corridors as you scroll from now to +15 minutes.

**How accurate the forecast is:** replayed on the team's last 40 minutes of real windows (115,134 of them),
its mean absolute error beats persistence ("the speed stays as it is") at every horizon: 3.19 against
3.32 km/h at 5 minutes, 3.99 against 4.20 at 10, 4.01 against 4.28 at 15. The first version lost to
persistence at all three; pooling the last windows by their vehicles and following the trend fully only
during a build-up fixed that. The live figures are on the console's Forecast page.

**What it looks like working:** with the Silk Board build-up started, the forecast moved Outer Ring
Road to "moderate, 26 km/h in 15 minutes" while it still read free at 34 km/h. The reason it gave was
density rising on two roads feeding it.

## How Condense is used

- **Kafka**: the team's managed Kafka on Condense carries every stage's input and output: seven
  topics under the team prefix `codeverse_`, created by `pipeline/topics.py`.
- **Applications**: one Python application, `arterial`, written in this repository, opened in
  Condense's browser IDE from GitHub, built by Condense from the `Dockerfile` and published as a custom
  Transform. Versions 1.0.0 to 1.2.0 were published as stages were added.
- **Pipeline**: the application is deployed four times on the pipeline canvas: validate-telemetry,
  segment-window, congestion-forecast and alert-router. Each is set through Condense variables
  (`ARTERIAL_STAGE`, the team prefix and the Kafka settings, with the password as a Password variable).
- **Observability**: Condense's per-transform logs, CPU and memory; the API adds each transform's
  consumer lag and the time from an event to the screen (about half a second).
- **Why custom transforms**: the sandbox Library offers five connectors and no Split or Alerts
  utility, so alert routing is a transform of its own, following the same rules.

## Tech stack

- **Data**: Geofabrik's India extract of OpenStreetMap (ODbL), read with pyosmium into a network of
  203,886 segments over 368,587 km (expressways, national and state highways) and Bengaluru in street
  detail (5,933 segments).
- **Simulator, stages, API**: Python 3.12, confluent-kafka, NumPy, PyYAML, FastAPI, Uvicorn, pytest.
- **Web app**: React 19, Vite, TypeScript, MapLibre GL with OpenFreeMap tiles, Motion, TanStack
  Query, Zustand, Vitest, Playwright.
- **AI tools**: Claude Code, as declared in [COMPLIANCE.md](COMPLIANCE.md).

## Challenges

- **Condense differed from its docs.** The v3 sandbox has no Split or Alerts utility, application
  names cannot contain underscores, and a cloned deployment would not deploy until its CPU and memory
  boxes were left empty. We worked these out by trying, and wrote them down in `docs/ARCHITECTURE.md`.
- **A whole country in a browser.** 203,886 segments froze the map at first. Now only roads with data
  get coloured, state highways appear from regional zoom, and the landing asks for its 21 corridors
  alone. Measured: 33 to 143 frames per second.
- **Sparse probes.** A few hundred vehicles over thousands of kilometres leave most windows with one
  or two cars. Thin windows hold the previous level and are left out of the forecast's trend, and a
  forming jam draws a share of trips into it, as real traffic does.
- **Honest numbers.** No metric is hard-coded: roads without reports show "no data", the forecast
  scores itself in public, and the incidents view stays empty because that stage was not built.

## Limitations

- All traffic is simulated. Commercial live-traffic terms forbid storing their data in a stream, so
  none is used.
- The simulator and the API run on a laptop; only the four stages run on Condense.
- Incident detection is not built.
- The forecast is a rule baseline that beats persistence by 4 to 6%; no trained model has replaced it yet.
- The API keeps its state in memory and rebuilds it from Kafka on start; there is no database.
- On the national tier, 1,500 vehicles over 368,587 km leave most segments without a recent window.

## Next steps

- An incident detector stage: sudden speed drops, abnormal accumulation and possible blockages, each
  with its evidence.
- A trained forecast per horizon on backfilled history, shipped only if it beats persistence on
  held-out data.
- The simulator as a custom input connector on Condense, and the API hosted beside it.
- Licensed live probe data in place of the simulator, once a licence allows it.
