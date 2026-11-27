import type { StyleSpecification } from 'maplibre-gl';

/**
 * The console's basemap: OpenStreetMap data from OpenFreeMap's vector tiles (OpenMapTiles schema), drawn
 * with Arterial's own layers. It reads as a real city at night: the road hierarchy from motorway down to
 * service lane, lakes a shade darker, parks, buildings once you zoom in, and the names of roads, lakes and
 * neighbourhoods. Everything is a cool night grey, so the congestion colours on top stay the loudest thing.
 * Only the tile source, fonts and sprite come from OpenFreeMap's published style.
 */
export const BASEMAP_URL = 'https://tiles.openfreemap.org/styles/dark';

const C = {
  ground: '#101010',
  residential: '#131313',
  park: '#141414',
  water: '#0c0c0c',
  waterLabel: '#7c7c7c',
  aeroway: '#171717',
  runway: '#292929',
  building: '#1b1b1b',
  buildingEdge: '#242424',
  casing: '#0b0b0b',
  path: '#212121',
  service: '#252525',
  minor: '#2f2f2f',
  tertiary: '#393939',
  secondary: '#444444',
  primary: '#525252',
  motorway: '#616161',
  rail: '#2c2c2c',
  roadLabel: '#a2a2a2',
  place: '#a3a3a3',
  city: '#d5d5d5',
};

const FONT = ['Noto Sans Regular'];
const NAME = ['coalesce', ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']];
const line = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const polygon = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
const point = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false];

export type Layer = Record<string, unknown>;

/** Width in pixels at zooms 10, 14 and 18, eased like a real road getting wider as you come closer. */
const width = (z10: number, z14: number, z18: number) => ['interpolate', ['exponential', 1.5], ['zoom'], 10, z10, 14, z14, 18, z18];

function road(id: string, classes: string[], color: string, w: [number, number, number], minzoom: number, casing = false): Layer[] {
  const filter = ['all', line, ['match', ['get', 'class'], classes, true, false]];
  const out: Layer[] = [];
  if (casing)
    out.push({
      id: `${id}-casing`,
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: minzoom + 1,
      filter,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': C.casing, 'line-width': width(w[0] + 1, w[1] + 1.6, w[2] + 3) },
    });
  out.push({
    id,
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'transportation',
    minzoom,
    filter,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': color,
      'line-width': width(...w),
      // tunnels show faintly, the way a map draws what runs under the street
      'line-opacity': ['case', ['==', ['get', 'brunnel'], 'tunnel'], 0.4, 1],
    },
  });
  return out;
}

function layers(): Layer[] {
  return [
    { id: 'ground', type: 'background', paint: { 'background-color': C.ground } },
    {
      id: 'residential',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['all', polygon, ['==', ['get', 'class'], 'residential']],
      paint: { 'fill-color': C.residential },
    },
    {
      id: 'park',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['all', polygon, ['match', ['get', 'class'], ['wood', 'grass'], true, false]],
      paint: { 'fill-color': C.park },
    },
    {
      id: 'park-landuse',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'park',
      filter: polygon,
      paint: { 'fill-color': C.park },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      filter: ['all', polygon, ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: { 'fill-color': C.water },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'waterway',
      filter: line,
      paint: { 'line-color': C.water, 'line-width': width(0.6, 1.6, 5) },
    },
    {
      id: 'aeroway-area',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'aeroway',
      minzoom: 11,
      filter: polygon,
      paint: { 'fill-color': C.aeroway },
    },
    {
      id: 'runway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'aeroway',
      minzoom: 11,
      filter: ['all', line, ['match', ['get', 'class'], ['runway', 'taxiway'], true, false]],
      paint: { 'line-color': C.runway, 'line-width': ['match', ['get', 'class'], 'runway', 6, 1.5] },
    },
    {
      id: 'building',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 13.5,
      filter: polygon,
      paint: {
        'fill-color': C.building,
        'fill-outline-color': C.buildingEdge,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 15, 1],
      },
    },
    {
      id: 'path',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 15,
      filter: ['all', line, ['==', ['get', 'class'], 'path']],
      paint: { 'line-color': C.path, 'line-width': 1, 'line-dasharray': [2, 2] },
    },
    {
      id: 'rail',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 12,
      filter: ['all', line, ['match', ['get', 'class'], ['rail', 'transit'], true, false]],
      paint: { 'line-color': C.rail, 'line-width': width(0.6, 1.2, 3), 'line-dasharray': [3, 2] },
    },
    ...road('road-service', ['service', 'track'], C.service, [0.2, 0.8, 7], 13),
    ...road('road-minor', ['minor'], C.minor, [0.3, 1.4, 12], 12),
    ...road('road-tertiary', ['tertiary'], C.tertiary, [0.6, 2.2, 16], 11),
    ...road('road-secondary', ['secondary'], C.secondary, [0.8, 2.8, 20], 10, true),
    ...road('road-primary', ['primary', 'trunk'], C.primary, [1, 3.4, 24], 9, true),
    ...road('road-motorway', ['motorway'], C.motorway, [1.2, 4, 28], 8, true),
    // lakes are named along a line through them in these tiles, small ponds at a point
    {
      id: 'water-name',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      minzoom: 11.5,
      filter: line,
      layout: {
        'symbol-placement': 'line',
        'text-field': NAME,
        'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 14],
        'text-max-angle': 40,
      },
      paint: { 'text-color': C.waterLabel, 'text-halo-color': C.ground, 'text-halo-width': 1.2 },
    },
    {
      id: 'water-name-point',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      minzoom: 13,
      filter: point,
      layout: { 'text-field': NAME, 'text-font': ['Noto Sans Italic'], 'text-size': 11, 'text-max-width': 7 },
      paint: { 'text-color': C.waterLabel, 'text-halo-color': C.ground, 'text-halo-width': 1.2 },
    },
    {
      id: 'road-name-major',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      minzoom: 12,
      filter: ['all', line, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary'], true, false]],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 320,
        'text-field': NAME,
        'text-font': FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 17, 13],
        'text-max-angle': 30,
        'text-rotation-alignment': 'map',
      },
      paint: { 'text-color': C.roadLabel, 'text-halo-color': C.ground, 'text-halo-width': 1.4 },
    },
    {
      id: 'road-name-minor',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      minzoom: 15,
      filter: ['all', line, ['match', ['get', 'class'], ['tertiary', 'minor'], true, false]],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 280,
        'text-field': NAME,
        'text-font': FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 18, 12],
        'text-max-angle': 30,
        'text-rotation-alignment': 'map',
      },
      paint: { 'text-color': C.roadLabel, 'text-halo-color': C.ground, 'text-halo-width': 1.4 },
    },
    {
      id: 'place-area',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      minzoom: 11,
      maxzoom: 16,
      filter: ['all', point, ['match', ['get', 'class'], ['suburb', 'quarter', 'neighbourhood', 'village', 'hamlet'], true, false]],
      layout: {
        'text-field': NAME,
        'text-font': FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 12.5],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.08,
        'text-max-width': 8,
      },
      paint: { 'text-color': C.place, 'text-halo-color': C.ground, 'text-halo-width': 1.4 },
    },
    {
      id: 'place-city',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      maxzoom: 12,
      filter: ['all', point, ['match', ['get', 'class'], ['city', 'town'], true, false]],
      layout: { 'text-field': NAME, 'text-font': ['Noto Sans Bold'], 'text-size': 14 },
      paint: { 'text-color': C.city, 'text-halo-color': C.ground, 'text-halo-width': 1.6 },
    },
  ];
}

/** The basemap's first label layer: Arterial's road lines go under it, so names stay readable on top. */
export const FIRST_LABEL = 'water-name';

/** A plain ground to draw on when the basemap cannot be fetched. */
export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': C.ground } }],
};

/** OpenFreeMap's main tile index: the second choice when the one its style names cannot be read. */
const PLANET_URL = 'https://tiles.openfreemap.org/planet';

type TileIndex = { tiles?: string[]; minzoom?: number; maxzoom?: number; bounds?: number[]; attribution?: string };

/**
 * The tile addresses behind a tile index, asked fresh. OpenFreeMap moves its tiles between builds, and
 * between its main and backup sets, and the browser keeps its style for a day and its index for an hour:
 * a stale copy can point at tiles that are gone, which draws the map with no city on it. "no-cache" makes
 * the browser check with OpenFreeMap each time, which costs a small "not modified" answer when nothing moved.
 */
async function freshTiles(url: string, signal?: AbortSignal) {
  const res = await fetch(url, { signal, cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const index = (await res.json()) as TileIndex;
  if (!index.tiles?.length) throw new Error('no tiles');
  return {
    type: 'vector',
    tiles: index.tiles,
    minzoom: index.minzoom ?? 0,
    maxzoom: index.maxzoom ?? 14,
    ...(index.bounds ? { bounds: index.bounds } : {}),
    ...(index.attribution ? { attribution: index.attribution } : {}),
  };
}

/**
 * A style on OpenFreeMap's tiles with the given layers, or the plain ground when the tiles cannot be
 * reached. The console uses Arterial's basemap layers; the landing passes its own night-city layers.
 */
export async function loadTileStyle(make: () => Layer[], signal?: AbortSignal): Promise<{ style: StyleSpecification; ok: boolean; indexes: string[] }> {
  try {
    const res = await fetch(BASEMAP_URL, { signal, cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const published = (await res.json()) as StyleSpecification;
    const named = published.sources?.openmaptiles as { url?: string } | undefined;
    if (!named) throw new Error('no openmaptiles source');
    // resolve the tile index here, fresh, rather than leave it to the map and the browser's cache
    let source: unknown = named;
    const indexes = [...new Set([named.url, PLANET_URL].filter((u): u is string => !!u))];
    for (const url of indexes) {
      try {
        source = await freshTiles(url, signal);
        break;
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
      }
    }
    const style = {
      version: 8,
      glyphs: published.glyphs,
      sprite: published.sprite,
      sources: { openmaptiles: source },
      layers: make(),
    } as unknown as StyleSpecification;
    return { style, ok: true, indexes };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return { style: FALLBACK_STYLE, ok: false, indexes: [] };
  }
}

/** The tile addresses of one of OpenFreeMap's tile indexes, asked fresh, or null when it cannot be read. */
export async function tilesAt(url: string, signal?: AbortSignal): Promise<string[] | null> {
  try {
    return (await freshTiles(url, signal)).tiles;
  } catch {
    return null;
  }
}

export function loadBasemap(signal?: AbortSignal): Promise<{ style: StyleSpecification; ok: boolean; indexes: string[] }> {
  return loadTileStyle(layers, signal);
}
