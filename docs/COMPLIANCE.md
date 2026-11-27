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
builder, the region configs (the national tier and each city), the place gazetteer, every Kafka
producer and consumer, every Condense transform and pipeline, the API service, and the congestion,
forecast, incident, place-search and route engines. The India OpenStreetMap extract is downloaded
inside the window. Before the window, the region design exists only as documentation and as types
in `frontend/src/lib/contract.ts`.

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
- `places.ts` answers the place search over the bundled junctions, the way the real `/places`
  endpoint will over its region's network.

## AI tools

| Tool | Used for | How the output was checked |
|---|---|---|
| Claude Code (Anthropic) | Writing the frontend, the docs and the fixture road shapes | TypeScript compile, unit tests, Playwright tests, and review in a real browser |
| Figma AI image generation (GPT Image 2.5) | The landing's four road frames for the forecast section (`frontend/public/landing/forecast/*.webp`), made as one image of the same street at four traffic levels and cut apart | Checked by eye; the page labels them as illustrations, and which one shows follows the console's forecast |

The team is responsible for everything submitted. No event credentials, other teams' code or
personal data were given to an AI tool.

## Third-party code, data and assets

| Item | License | Use |
|---|---|---|
| React, React DOM | MIT | UI |
| React Router | MIT | Routing |
| Motion | MIT | Interface animation |
| React Bits: Hyperspeed | MIT + Commons Clause (use inside an application; the component itself is not sold or redistributed) | The night highway under the landing's closing call to action (adapted with a pause, a still under reduced motion, and no crash without WebGL). Copied into `frontend/src/components/reactbits/` with its copyright notice |
| OGL | Unlicense | The WebGL renderer under Morph Slider |
| Sonner | MIT | Incident notifications (toasts) |
| MapLibre GL JS | BSD-3-Clause | Map rendering |
| three.js, React Three Fiber, drei | MIT | Two 3D views: the forecast page's time stack (the network at now, +5, +10 and +15 minutes as stacked layers) and the analytics landscape (congestion by segment and hour as bars), which the landing page also shows, turned by the scroll |
| OpenFreeMap tiles, fonts and sprite | Tiles: OpenMapTiles; data: © OpenStreetMap contributors (ODbL) | The console's basemap, drawn with Arterial's own layer style, and the still of the city under the landing's forecast (`frontend/public/landing/forecast-city.webp`), drawn once with the landing's night-city layers; credited in the landing's footer |
| "Aerial Night View of Bengaluru Metro Cityscape" by Spotlight States, on Pexels | Pexels License (free to use and modify; credited in the landing's footer) | The landing's hero video (`frontend/public/landing/hero-night.mp4`, its opening 8.3 s re-encoded to 1280x720) and its first frame as the poster (`hero-night.jpg`). Stock footage of the city, not Arterial's data |
| TanStack Query | MIT | REST data fetching |
| Zustand | MIT | Live state store |
| d3-scale, d3-shape, d3-array | ISC | Chart geometry |
| Lucide icons | ISC | Icons |
| Schibsted Grotesk and JetBrains Mono fonts (self-hosted through Fontsource) | SIL Open Font License 1.1 | Typography |
| Vite, Vitest, Testing Library, Playwright, TypeScript | MIT, Apache-2.0 | Build and test |

Backend libraries are added here as they are used in the window.

## Data

Synthetic telemetry only. No real vehicles, people or location histories. Road geometry from
OpenStreetMap under ODbL, for every region Arterial runs; the national tier and the place gazetteer
come from Geofabrik's India extract of OpenStreetMap (ODbL). Generated network files are offered
under ODbL with attribution. Nothing in Arterial controls a real vehicle,
a traffic signal or live infrastructure.

Live traffic from commercial providers is not used. On 25 Nov 2026 we read the terms of Google Maps
Platform (Terms of Service 3.2.3; Service Specific Terms, Routes API 20.2 and 20.3), TomTom (portal
terms 11.4 and 11.6.1), HERE (Platform Terms, Base Plan Location Services exhibit 1.3, January 2022
text) and Mapbox (Product Terms 1.9 and 1.10). All four forbid storing their traffic results (TomTom
and HERE allow only short-lived HTTP caching), which a Kafka topic would do, so their data would not
count as licensed under the rules' data requirement.

## Outside help

None so far. Mentor help during the event will be listed here.
