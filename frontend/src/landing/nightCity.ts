import type { Layer } from '../components/map/basemap';

/**
 * The landing's map: India at night, drawn from OpenFreeMap's OpenStreetMap tiles. The roads are the light:
 * highways in a silver street light with a bloom round them, streets dimmer, so the country reads as the
 * web of lit roads a night photograph from orbit shows, and a city close up as its own street grid. Grey,
 * not a hue: the corridors' congestion colours must be the only colour on the map.
 * Buildings stand in 3D once the camera is low enough. The sea is darker than the land, so the coast draws
 * itself. No country borders are drawn. Arterial's own corridors are added on top by CityScene.
 */

const C = {
  land: '#111111',
  sea: '#070707',
  park: '#141414',
  residential: '#161616',
  building: '#171717',
  buildingTop: '#2a2a2a',
  // highways: cool street light, so the congestion colours on top stay the only colour
  highway: '#b9b9b9',
  highwayCore: '#f1f1f1',
  road: '#828282',
  street: '#606060',
  city: '#a2a2a2',
  glow: '#eaeaea',
  glowCore: '#ffffff',
};

const line = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const polygon = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
const point = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false];
const classes = (c: string[]) => ['all', line, ['match', ['get', 'class'], c, true, false], ['!=', ['get', 'brunnel'], 'tunnel']];
const z = (...stops: number[]) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops];

function road(id: string, c: string[], paint: Record<string, unknown>, minzoom = 0): Layer {
  return {
    id,
    type: 'line',
    source: 'openmaptiles',
    'source-layer': 'transportation',
    minzoom,
    filter: classes(c),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint,
  };
}

export function nightCityLayers(): Layer[] {
  const MAJOR = ['motorway', 'trunk', 'primary'];
  return [
    { id: 'land', type: 'background', paint: { 'background-color': C.land } },
    {
      id: 'residential',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      minzoom: 10,
      filter: ['all', polygon, ['==', ['get', 'class'], 'residential']],
      paint: { 'fill-color': C.residential },
    },
    {
      id: 'park',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'park',
      minzoom: 10,
      filter: polygon,
      paint: { 'fill-color': C.park },
    },
    {
      id: 'sea',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      filter: ['all', polygon, ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: { 'fill-color': C.sea, 'fill-antialias': true },
    },
    // streets: cool, thin, only once a city is close
    road('street', ['minor', 'service'], { 'line-color': C.street, 'line-width': z(12, 0.3, 15, 1.1, 17, 2.4), 'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.1, 14, 0.26, 16, 0.4] }, 12),
    road('secondary-glow', ['secondary', 'tertiary'], { 'line-color': C.road, 'line-width': z(9, 1, 12, 4, 15, 12), 'line-blur': z(9, 1, 12, 3, 15, 8), 'line-opacity': 0.16 }, 9),
    road('secondary', ['secondary', 'tertiary'], { 'line-color': C.road, 'line-width': z(9, 0.3, 12, 0.8, 15, 2.2), 'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.3, 13, 0.6] }, 9),
    // highways and main roads: sodium light with a bloom, from the whole country down to one junction
    road('major-bloom', MAJOR, { 'line-color': C.highway, 'line-width': z(3, 2, 7, 3, 11, 9, 14, 26), 'line-blur': z(3, 2, 7, 3, 11, 7, 14, 18), 'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.32, 9, 0.22, 14, 0.14] }),
    road('major', MAJOR, { 'line-color': C.highway, 'line-width': z(3, 0.35, 7, 0.7, 11, 1.4, 14, 3.4), 'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.75, 9, 0.7, 14, 0.55] }),
    road('major-core', ['motorway', 'trunk'], { 'line-color': C.highwayCore, 'line-width': z(3, 0.2, 7, 0.4, 11, 0.7, 14, 1.4), 'line-opacity': 0.8 }),
    {
      id: 'building',
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 12.5,
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, C.building, 40, C.buildingTop],
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13.5, 0.88],
        'fill-extrusion-vertical-gradient': true,
      },
    },
    // the country's cities as their own light, the way a night photograph from orbit shows them; they fade
    // as the camera comes down to the streets. No names: the readout says where the camera is.
    {
      id: 'city-glow',
      type: 'circle',
      source: 'openmaptiles',
      'source-layer': 'place',
      maxzoom: 10,
      filter: ['all', point, ['match', ['get', 'class'], ['city', 'town'], true, false]],
      paint: {
        'circle-color': C.glow,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, ['match', ['get', 'class'], 'city', 9, 3], 8, ['match', ['get', 'class'], 'city', 26, 8]],
        'circle-blur': 1,
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.42, 8, 0.3, 10, 0],
        'circle-pitch-alignment': 'map',
      },
    },
    {
      id: 'city-core',
      type: 'circle',
      source: 'openmaptiles',
      'source-layer': 'place',
      maxzoom: 10,
      filter: ['all', point, ['match', ['get', 'class'], ['city', 'town'], true, false]],
      paint: {
        'circle-color': C.glowCore,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, ['match', ['get', 'class'], 'city', 1.6, 0.7], 8, ['match', ['get', 'class'], 'city', 3, 1.4]],
        'circle-blur': 0.4,
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.9, 8, 0.6, 10, 0],
        'circle-pitch-alignment': 'map',
      },
    },
  ];
}

/** Lights the buildings from the upper left, the way a city's sky glow catches its towers. */
export const NIGHT_LIGHT = { anchor: 'viewport', color: '#ffffff', intensity: 0.24, position: [1.2, 210, 35] } as const;
