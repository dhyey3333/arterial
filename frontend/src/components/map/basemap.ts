import type { StyleSpecification } from 'maplibre-gl';

/**
 * OpenFreeMap's dark style (OpenMapTiles schema, OpenStreetMap data), recoloured
 * to Arterial's blue-black ground so the congestion colours carry the map.
 */
export const BASEMAP_URL = 'https://tiles.openfreemap.org/styles/dark';

const C = {
  background: '#070a0f',
  land: '#080c12',
  residential: '#0a0e15',
  park: '#0a1210',
  water: '#0b1624',
  building: '#0d121a',
  path: '#0f151f',
  minor: '#121a26',
  majorInner: '#172030',
  majorCasing: 'rgba(80, 100, 130, 0.28)',
  rail: '#111926',
  boundary: '#243041',
  label: '#566173',
  labelMajor: '#6e7a8b',
  halo: '#06080c',
};

type AnyLayer = { id: string; type: string; paint?: Record<string, unknown>; layout?: Record<string, unknown> };

function recolor(layer: AnyLayer) {
  const paint = (layer.paint ??= {});
  const id = layer.id;
  if (layer.type === 'background') paint['background-color'] = C.background;
  if (layer.type === 'fill') {
    paint['fill-color'] = id.includes('water')
      ? C.water
      : id.includes('building')
        ? C.building
        : id.includes('park') || id.includes('wood')
          ? C.park
          : id.includes('residential')
            ? C.residential
            : C.land;
    delete paint['fill-pattern'];
  }
  if (layer.type === 'line') {
    paint['line-color'] = id.includes('water')
      ? C.water
      : id.includes('casing')
        ? C.majorCasing
        : id.includes('rail')
          ? C.rail
          : id.includes('boundary')
            ? C.boundary
            : id.includes('path')
              ? C.path
              : id.includes('minor') || id.includes('subtle')
                ? C.minor
                : C.majorInner;
    if (id.includes('dashline')) paint['line-color'] = C.background;
  }
  if (layer.type === 'symbol') {
    if (id.startsWith('road_oneway')) {
      (layer.layout ??= {}).visibility = 'none';
      return;
    }
    paint['text-color'] = id.includes('motorway') || id.includes('city') ? C.labelMajor : C.label;
    paint['text-halo-color'] = C.halo;
    paint['text-halo-width'] = 1.2;
  }
}

/** A plain ground to draw on when the basemap cannot be fetched. */
export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': C.background } }],
};

export async function loadBasemap(signal?: AbortSignal): Promise<{ style: StyleSpecification; ok: boolean }> {
  try {
    const res = await fetch(BASEMAP_URL, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const style = (await res.json()) as StyleSpecification;
    (style.layers as AnyLayer[]).forEach(recolor);
    return { style, ok: true };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return { style: FALLBACK_STYLE, ok: false };
  }
}
