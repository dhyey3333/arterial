import { describe, expect, it } from 'vitest';
import { toPlane } from './geometry';
import { buildNetwork } from './traffic';

const roads = toPlane(null).segments.map((s) => ({
  id: s.id,
  name: s.name,
  lengthM: s.lengthM,
  freeFlowKph: s.freeFlowKph,
  fromNode: s.fromNode,
  toNode: s.toNode,
  pts: s.pts,
}));

/** Each junction as the sorted road ids with a stop line there, and which of them get the side road's phase. */
function junctionsOf(net: ReturnType<typeof buildNetwork>) {
  const at = new Map<number, { roads: Set<string>; side: Set<string> }>();
  for (const st of net.stops) {
    const j = at.get(st.junction) ?? at.set(st.junction, { roads: new Set(), side: new Set() }).get(st.junction)!;
    j.roads.add(roads[st.road].id);
    if (st.group === 1) j.side.add(roads[st.road].id);
  }
  return [...at.values()].map((j) => ({ roads: [...j.roads].sort().join(' '), side: [...j.side].sort().join(' ') }));
}

describe('the traffic network', () => {
  const net = buildNetwork(roads);

  it('puts traffic lights where the network’s roads meet, and nowhere else', () => {
    expect(junctionsOf(net).map((j) => j.roads).sort()).toEqual(
      [
        'ORR-02 SJR-01', // Iblur Junction
        'M27-01 ORR-02', // 27th Main and ORR
        'M19-01 ORR-03', // 19th Main and ORR
        'MHM-01 TVK-01', // Tavarekere and Marigowda Road
        'M29-01 ORR-04', // 29th Main and ORR
        'BGR-01 HSR-02', // Begur Road and Hosur Road
        'HSR-03 ORR-03 ORR-04', // Silk Board
        'IRR-02 KFT-01', // Sony World Junction
      ].sort(),
    );
  });

  it('gives the side road its own phase, so it goes while the main road waits', () => {
    const sides = Object.fromEntries(junctionsOf(net).map((j) => [j.roads, j.side]));
    expect(sides['ORR-02 SJR-01']).toBe('SJR-01');
    expect(sides['BGR-01 HSR-02']).toBe('BGR-01');
    expect(sides['HSR-03 ORR-03 ORR-04']).toBe('HSR-03');
  });

  it('stops each lane before the junction, inside its road', () => {
    for (const st of net.stops) {
      expect(st.s).toBeGreaterThan(0);
      expect(st.s).toBeLessThan(roads[st.road].lengthM);
    }
  });

  it('lets a side road turn onto the road it meets, both ways, partway along it', () => {
    const iblur = roads.findIndex((r) => r.id === 'SJR-01');
    const orr = roads.findIndex((r) => r.id === 'ORR-02');
    // SJR-01 starts at Iblur Junction, so the lane running into it travels against the road's direction
    const turns = net.exits.get(net.laneKey(iblur, -1)) ?? [];
    expect(turns.filter((e) => e.road === orr).map((e) => e.dir).sort()).toEqual([-1, 1]);
    for (const e of turns) expect(e.s0).toBeGreaterThan(0);
  });

  it('runs no lights when asked not to', () => {
    expect(buildNetwork(roads, false).stops).toHaveLength(0);
  });
});
