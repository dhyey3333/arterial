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
| Web app (`frontend/`) | Working on design fixtures; reads the live API once it exists | Before the build window, disclosed |
| Architecture, API and event contracts (`docs/`) | Written | Before the build window |
| Telemetry simulator | Not started | Build window, from Sat 28 Nov 00:00 IST |
| Condense pipeline and Kafka topics | Not started | Build window |
| API service, persistence, forecast, incident and route engines | Not started | Build window |

The rules allow frontend code and documentation before the window and require the backend and
pipeline to be built inside it. [docs/COMPLIANCE.md](docs/COMPLIANCE.md) lists what was prepared
when. **End-to-end integration is not claimed** until a simulated event has gone through the
Condense pipeline and shown up in this app.

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

The forecast section plays the console's own forecast on the city (`frontend/src/landing/ForecastMap.tsx`).
As the page scrolls from now to +15 minutes, each corridor, drawn on its road over a still of Bengaluru at
night, takes the colour of its forecast speed as a share of its free-flow speed: green at free flow,
through amber, to red at severe. At now and at 5, 10 and 15 minutes the colour is the forecast's; between
those steps it blends from one step's forecast to the next. Headlights run along each corridor at its
forecast speed, so they slow as it reddens, and the corridor the forecast flags worst carries its name and
its speed at the current step. The still (`frontend/public/landing/forecast-city.webp`, 198 KB) is
OpenFreeMap's tiles drawn with the landing's night-city layers and saved once, with the corridors projected
from the same camera (`frontend/src/landing/forecastCorridors.json`), so it shows at once on any connection
and needs no WebGL. The frame opens once, the corridors drawing themselves in; the headlights pause with
their button and while off screen; under reduced motion the colours still follow the scroll and nothing
else moves. With no forecast yet the corridors are grey.

The page closes on a night highway under its last call to action (React Bits' Hyperspeed, as it looks at night: tail lights in brake red, headlights in warm white). It is decoration and shows no data; it pauses with its button, rests off screen, and is a still under reduced motion.

Further down, the analytics page's 3D landscape (`frontend/src/landing/WeekPeaks.tsx`) rises when it
comes into view and turns as the page scrolls, drawn from the console's own analytics; without a GPU
the same hours show as the flat grid. The two console screenshots stand up as they scroll in, a CSS
scroll-driven animation that browsers without view timelines skip.

Against the real API (once it exists):

```bash
cp ../.env.example .env        # set VITE_API_URL
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
`.env`, which git ignores. Kafka topics and consumer groups all start with the team prefix the
organizers assign.

## Reproducing the demo

Built during the window: a seeded simulator (`SIM_SEED=2026`) with scenarios for normal traffic,
peak hours, gradual build-up, a sudden slowdown and an incident. Steps go here once they exist.

## License

[MIT](LICENSE). Third-party code, fonts, map tiles and data are listed with their licenses in
[docs/COMPLIANCE.md](docs/COMPLIANCE.md). Road geometry © OpenStreetMap contributors (ODbL).
