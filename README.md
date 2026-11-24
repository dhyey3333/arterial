# Arterial

Real-time traffic intelligence on Condense, built for Configure 2026 (Condense × Bosch Mobility
Platforms & Solutions).

Arterial watches simulated vehicle telemetry for a road network in south-east Bengaluru (Outer
Ring Road, Hosur Road, Sarjapur Road, HSR Layout, Koramangala, BTM). Every 30 seconds it tells a
traffic operator which road segments are congested and why. It forecasts which ones will slow in
the next 5, 10 and 15 minutes, flags abnormal patterns with the evidence behind each, and routes
fleets around the jam forming now.

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

Design fixtures are hand-written sample data. A banner says so on every page while they are in
use, and the production build leaves them out entirely.

Against the real API (once it exists):

```bash
cp ../.env.example .env        # set VITE_API_URL
npm run dev                    # or: npm run build && npm run preview
```

With no API reachable, the app says it cannot load traffic data and keeps retrying the stream. It
never shows numbers it did not receive.

### Tests

```bash
npm test          # 40 unit tests: stream reconnects, store reducers, API errors, formatting, components
npm run e2e       # 12 Playwright tests in Chrome: every page on fixtures, plus the live build with the API down
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
