# Configure 2026 declarations

Kept current through the hackathon and copied into the submission form.

## Work prepared before the build window

The rules (section 08) allow prebuilt frontend code if it is disclosed, and require the backend and
pipeline to be built inside the window (Sat 28 Nov 00:00 IST to Sun 29 Nov 23:59 IST).

Prepared from 24 Nov 2026, before the window:

| Path | What it is |
|---|---|
| `frontend/` | The React web app: layout, design system, pages, map, charts, the API and stream client, and design fixtures |
| `docs/` | Architecture, API and event contracts, build plan, these declarations |
| `LICENSE`, `.gitignore`, `.env.example`, `README.md` | Repository setup |

**Not** prepared before the window, and built inside it: the telemetry simulator, the road network
builder, every Kafka producer and consumer, every Condense transform and pipeline, the API service,
and the congestion, forecast, incident and route engines.

Git history shows the split: every commit dated before 2026-11-28 00:00 IST touches only the paths
above. (The commit range will be listed here at submission.)

### Design fixtures

`frontend/src/fixtures/` holds sample data used only when `VITE_DATA_SOURCE=fixtures`, to build and
test the interface before any backend exists. It is never used in the demo and the app shows a
"Design fixtures" banner whenever it is active.

- `network.json`: road shapes traced from OpenStreetMap ways (© OpenStreetMap contributors, ODbL),
  fetched once through the Overpass API on 24 Nov 2026 and cut into segments by hand-tuned script
  outside this repository. The backend builds its own network inside the window.
- Every traffic number in the fixtures is hand-written sample data, not output from any model or
  simulator.

## AI tools

| Tool | Used for | How the output was checked |
|---|---|---|
| Claude Code (Anthropic) | Writing the frontend, the docs and the fixture road shapes | TypeScript compile, unit tests, Playwright tests, and review in a real browser |

The team is responsible for everything submitted. No event credentials, other teams' code or
personal data were given to an AI tool.

## Third-party code, data and assets

| Item | License | Use |
|---|---|---|
| React, React DOM | MIT | UI |
| React Router | MIT | Routing |
| Motion | MIT | Interface animation |
| MapLibre GL JS | BSD-3-Clause | Map rendering |
| OpenFreeMap tiles and style | Tiles: OpenMapTiles; data: © OpenStreetMap contributors (ODbL) | Basemap |
| TanStack Query | MIT | REST data fetching |
| Zustand | MIT | Live state store |
| d3-scale, d3-shape, d3-array | ISC | Chart geometry |
| Lucide icons | ISC | Icons |
| Geist and Geist Mono fonts | SIL Open Font License 1.1 | Typography |
| Vite, Vitest, Testing Library, Playwright, TypeScript | MIT, Apache-2.0 | Build and test |

Backend libraries are added here as they are used in the window.

## Data

Synthetic telemetry only. No real vehicles, people or location histories. Road geometry from
OpenStreetMap under ODbL. Nothing in Arterial controls a real vehicle, a traffic signal or live
infrastructure.

## Outside help

None so far. Mentor help during the event will be listed here.
