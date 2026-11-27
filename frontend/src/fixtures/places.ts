import type { PlaceResult, PlaceSearch, RoadNetwork } from '../lib/contract';

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * GET /places on the design fixtures: the junctions of the bundled network whose name, or a road meeting
 * there, matches every word of the query (each word as the start of a word). The real API does the same
 * over its region's network and, on the national tier, its gazetteer of towns (docs/ARCHITECTURE.md 2.1).
 */
export function searchPlaces(network: RoadNetwork, query: string, limit = 8): PlaceSearch {
  const words = norm(query);
  const roadsAt = new Map<string, Set<string>>();
  for (const s of network.segments) {
    for (const n of [s.from_node, s.to_node]) {
      if (!roadsAt.has(n)) roadsAt.set(n, new Set());
      roadsAt.get(n)!.add(s.name);
    }
  }
  const scored: { score: number; place: PlaceResult }[] = [];
  if (words.length) {
    for (const node of network.nodes) {
      const roads = [...(roadsAt.get(node.id) ?? [])];
      const nameWords = norm(node.name);
      const roadWords = roads.flatMap(norm);
      let score = 0;
      let all = true;
      for (const w of words) {
        if (nameWords.some((x) => x.startsWith(w))) score += nameWords[0].startsWith(w) ? 3 : 2;
        else if (roadWords.some((x) => x.startsWith(w))) score += 1;
        else {
          all = false;
          break;
        }
      }
      if (!all) continue;
      scored.push({
        score,
        place: { kind: 'junction', name: node.name, context: null, lng: node.lng, lat: node.lat, node_id: node.id, roads, distance_m: 0 },
      });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name));
  return { query, region: network.region?.id ?? '', places: scored.slice(0, limit).map((x) => x.place) };
}
