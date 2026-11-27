# Arterial

Real-time traffic intelligence on Condense, built for Configure 2026 (Condense × Bosch Mobility
Platforms & Solutions).

Arterial watches simulated vehicle telemetry on India's roads. Every 30 seconds it tells a traffic
operator which road segments are congested and why. It forecasts which ones will slow in the next
5, 10 and 15 minutes, flags abnormal patterns with the evidence behind each, and routes fleets
around the jam forming now.

The backend, built in the window, is designed to cover India at two levels of detail: a national
tier of expressways and national highways across the country, and cities street by street,
Bengaluru first. Each is a setting with its road network from OpenStreetMap, and nothing else
changes (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), section 2.1). The design fixtures in
`frontend/` cover south-east Bengaluru (Outer Ring Road, Hosur Road, Sarjapur Road, HSR Layout,
Koramangala, BTM). Coverage beyond Bengaluru is claimed here only once it has run end to end.

All traffic data is **simulated**. Arterial never connects to a real vehicle, traffic signal or
live infrastructure.

## Status

| Part | State | Built |
|---|---|---|
| Web app (`frontend/`) | Working against the live API; design fixtures remain for development | Before the build window, disclosed; adapted to the live data in the window |
| Architecture, API and event contracts (`docs/`) | Written, and corrected with what Condense showed | Before the window, updated in it |
| Road networks (`simulator/osm_extract.py`, `network.py`) | All of India (expressways, national and state highways: 203,886 segments, 368,587 km) and Bengaluru in street detail (5,933 segments), from the Geofabrik India extract | Build window |
| Telemetry simulator (`simulator/sim.py`) | Running: seeded vehicles on the real road network, a time-of-day demand model, build-up and incident scenarios started on demand | Build window |
| Condense pipeline (`pipeline/`) | Running on Condense as three transforms of the application `arterial`, built from this repository's `Dockerfile`: validate-telemetry, segment-window, congestion-forecast | Build window |
| API (`api/`) | Running: REST, Server-Sent Events, routes (A*), place search, the landing's corridor view, scenario control; state rebuilt from Kafka on start, no database yet | Build window |
| Forecast | Rule baseline running on Condense, its accuracy measured live against persistence; no trained model yet | Build window |
| Alerts and incident detection | Not started | Build window |

**End to end, demonstrated on 28 Nov 2026:** simulated telemetry goes to the team's Kafka topics on
Condense, through the three transforms running on Condense, to the API and into the browser, where the
console shows the whole country live. [docs/COMPLIANCE.md](docs/COMPLIANCE.md) lists what was prepared
before the window and what was built in it.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): system diagram, the Condense pipeline, congestion
  formulas and thresholds, forecast and evaluation plan, incident rules, routing, persistence,
  failure handling.
- [API](docs/API.md): REST endpoints and the Server-Sent Events stream.
- [Events](docs/EVENTS.md): Kafka topics and message schemas.
- [Build plan](docs/BUILD-PLAN.md): the 48 hours, and the demo scenario.
- [Declarations](docs/COMPLIANCE.md): prepared work, AI tools, third-party code and data.

## Run the web app

Needs Node 20 or newer.

```bash
cd frontend
npm install
npm run dev:fixtures   # the full interface on design fixtures, http://localhost:5173
```

The landing page is at `/` and the console at `/console`. Design fixtures are hand-written sample
data. A banner says so on every console page while they are in use, the landing says so under its
headline, and the production build leaves the sample data out. Only the road geometry (traced from
OpenStreetMap) ships in it, so the landing can draw the network before any API answers.

The console's basemap is OpenStreetMap data from OpenFreeMap's vector tiles, drawn with Arterial's own
dark style (`frontend/src/components/map/basemap.ts`).

The landing opens on a real night view of Bengaluru from the air, looping (`frontend/src/landing/HeroVideo.tsx`):
stock footage, "Aerial Night View of Bengaluru Metro Cityscape" by Spotlight States on Pexels (Pexels
License), its opening 8.3 seconds re-encoded to 1280x720 H.264 (2.3 MB) and credited in the footer. It is
footage of the city, not Arterial's data. It ships with the site, so it does not wait on any map service:
its first frame (57 KB) shows at once and the clip fades in when it can play. Two copies cross-fade at the
seam so the loop never jumps. It pauses with its button and while off screen, and is the still under
reduced motion or when the browser asks to save data.

An earlier hero, a night-city map flying from peninsular India down to the corridors
(`frontend/src/landing/CityScene.tsx`, `nightCity.ts` and the traffic animation in `traffic.ts`), is
still in the source but no longer on the page.

The forecast section plays Arterial's live forecast on Bengaluru (`frontend/src/landing/ForecastMap.tsx`).
It draws 21 corridors (Outer Ring Road, Hosur Road, Sarjapur Road, Inner Ring Road and the streets of HSR
Layout) over a still of the city at night, and asks the API for them alone (`GET /api/v1/corridors`), so
the page never loads the whole country. Each corridor's level and its 5, 10 and 15 minute forecasts are
length-weighted from the live segments under it, matched once by `python -m simulator.landing_corridors`
(89 to 110% of each corridor's length, `config/landing-corridors.json`); the forecasts come from the
congestion-forecast transform on Condense. As the page scrolls from now to +15 minutes, each corridor takes
the colour of its forecast speed as a share of its free-flow speed: green at free flow, through amber, to
red at severe, blending between the steps. Headlights run along each corridor at its forecast speed, and
the corridor the forecast flags worst carries its name and speed. The still
(`frontend/public/landing/forecast-city.webp`) is OpenFreeMap's tiles drawn once with the landing's
night-city layers. With no forecast yet the corridors are grey; the page never shows a forecast it did not
receive.

The page closes on a night highway under its last call to action (React Bits' Hyperspeed, as it looks at night: tail lights in brake red, headlights in warm white). It is decoration and shows no data; it pauses with its button, rests off screen, and is a still under reduced motion.

Further down, the analytics page's 3D landscape (`frontend/src/landing/WeekPeaks.tsx`) rises when it
comes into view and turns as the page scrolls, drawn from the console's own analytics; without a GPU
the same hours show as the flat grid. The two console screenshots stand up as they scroll in, a CSS
scroll-driven animation that browsers without view timelines skip.

Against the live API (see Run the backend, below), with `frontend/.env.local` holding
`VITE_API_URL=http://localhost:8000` and `VITE_DATA_SOURCE=live`:

```bash
npm run dev                    # or: npm run build && npm run preview
```

With no API reachable, the app says it cannot load traffic data and keeps retrying the stream. It
never shows numbers it did not receive.

### Tests

```bash
npm test          # 45 unit tests: stream reconnects, store reducers, API errors, formatting, components
npm run e2e       # 18 Playwright tests in Chrome: the landing and every console page on fixtures, plus the live build with the API down
npm run typecheck
```

## Configuration

Every variable is listed in [.env.example](.env.example) without values. Secrets live only in
`.env`, which git ignores. Kafka topics and consumer groups all start with the team prefix
(`TEAM_PREFIX`, `codeverse_` for this team), as the team's Kafka access requires.

## Run the backend

Needs Python 3.11 or newer.

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # bin/ on macOS and Linux
cp .env.example .env               # Kafka bootstrap servers, SASL mechanism, username, password, TEAM_PREFIX

# road networks, once: download india-latest.osm.pbf from download.geofabrik.de into data/raw/
python -m simulator.osm_extract    # India's motorway to tertiary roads, about 8 minutes
python -m simulator.network in     # the national tier
python -m simulator.network blr    # Bengaluru in street detail
python -m pipeline.topics          # creates the team's topics if missing

python -m simulator.sim --region in --vehicles 1500
python -m simulator.sim --region blr
ARTERIAL_REGION=in python -m uvicorn api.main:app --port 8000
```

On Condense, the application `arterial` (Python) is built from this repository's `Dockerfile` and
published as a Transform. Each stage is one deployment of it with `ARTERIAL_STAGE` set to `validate`,
`window` or `forecast`, plus `TEAM_PREFIX` and the `KAFKA_*` variables (the password as a Password
variable). For local testing, `python -m pipeline.run <stage>` runs the same code against the same topics,
and `python -m pipeline.peek 60` shows what flows through each topic for a minute.

```bash
.venv/Scripts/python -m pytest tests    # validation, windows, levels with hysteresis, forecast scoring
```

## Reproducing the demo

With the simulator, the transforms and the API running, start a jam on Outer Ring Road at Silk Board:

```bash
curl -X POST http://localhost:8000/api/v1/sim/scenario -H "Content-Type: application/json"   -d '{"scenario": "build_up", "region": "blr", "minutes": 30}'
```

Over about 18 minutes a 1.5 km stretch of the road loads to severe, with the roads feeding it heavy and
the next ring moderate. The forecast flags the slowdown before the level changes; the landing's forecast
section and the console show it as it forms. `{"scenario": "clear"}` ends it. Only the simulator changes;
nothing outside the simulation is touched.

## License

[MIT](LICENSE). Third-party code, fonts, map tiles and data are listed with their licenses in
[docs/COMPLIANCE.md](docs/COMPLIANCE.md). Road geometry © OpenStreetMap contributors (ODbL).
