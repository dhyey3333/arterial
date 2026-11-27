/*
 * A small traffic simulation for the landing, drawn as night traffic seen from above in a long exposure:
 * headlight streaks on vehicles coming towards the camera, taillight streaks on vehicles going away,
 * brake lights flaring when a vehicle slows hard, each streak as long as the vehicle's speed.
 *
 * Each road carries one lane each way, on the left as in India. Vehicles follow the one ahead with the
 * Intelligent Driver Model (IDM: Treiber, Hennecke and Helbing, 2000), so they brake, queue and pull
 * away, and stop-and-go waves form on their own where a road is dense. The junctions where the network's
 * roads meet run fixed-time traffic lights: the main road's green, then the side road's, so queues build
 * at red and clear on green, and a side-road vehicle turning onto the main road waits for a gap. A road's
 * vehicle count follows its density and its speed its speed, from whatever `read` returns: the live
 * stream in the hero, the forecast for the scrolled-to minute in the scrub. Without data every road runs
 * at free flow with a light, even load, and nothing about it is claimed as data.
 *
 * Framework-free: it owns one canvas and its own frame loop, and the React parts only mount it.
 */

export interface SimRoad {
  id: string;
  name: string;
  lengthM: number;
  freeFlowKph: number;
  fromNode: string;
  toNode: string;
  /** Plane points along the road, evenly spaced. */
  pts: [number, number][];
}

export interface RoadNow {
  kph: number | null;
  densityPerKm: number | null;
}

interface Kind {
  name: 'bike' | 'car' | 'bus';
  share: number;
  lengthM: number;
  maxKph: number;
  accel: number;
  headway: number;
  light: number;
}

const KINDS: Kind[] = [
  { name: 'bike', share: 0.5, lengthM: 2, maxKph: 60, accel: 2.0, headway: 0.8, light: 0.75 },
  { name: 'car', share: 0.4, lengthM: 4.5, maxKph: 70, accel: 1.4, headway: 1.2, light: 1 },
  { name: 'bus', share: 0.1, lengthM: 11, maxKph: 50, accel: 0.8, headway: 1.6, light: 1.35 },
];

/** Where a vehicle goes when its lane ends: a road, a direction, and how far along it the vehicle joins. */
interface Exit {
  road: number;
  dir: 1 | -1;
  s0: number;
}

interface Vehicle {
  road: number;
  dir: 1 | -1;
  s: number;
  v: number;
  acc: number;
  kind: Kind;
  drive: number;
  next: Exit | null;
  /** The road it came off, so a streak can reach back round the junction. */
  prev: { road: number; dir: 1 | -1 } | null;
  /** How far along this road it joined (0 at a road's start; partway along after a turn). */
  entry: number;
  /** Headlamp colour: halogen (warm) or LED (cool). */
  cool: boolean;
  fade: number;
  leaving: boolean;
}

/** A stop line: a traffic light on one lane, part of a junction, shown to the main road (0) or side road (1). */
interface Stop {
  road: number;
  dir: 1 | -1;
  s: number;
  junction: number;
  group: 0 | 1;
}

const SIM_STEP = 0.25;         // seconds of simulated time per integration step
const MIN_GAP = 2;             // metres, standing gap
const COMFORT_BRAKE = 2.2;     // m/s²
const DEFAULT_DENSITY = 12;    // vehicles per km, both ways, when no data
const VISIBLE_SHARE = 0.5;     // share of the real vehicles drawn, so the picture stays legible
const STREAK_STEPS = 6;        // points along a streak, so it bends with the road

// A fixed-time plan, 90 seconds: the main road's green, amber and all-red, then the side road's.
// [green from, amber from, red from], in seconds into the cycle.
const CYCLE = 90;
const PLAN: Record<0 | 1, [number, number, number]> = { 0: [0, 44, 47], 1: [49, 85, 88] };
const SIDE_REACH_M = 60;       // a road that ends this close to another road meets it there
const NODE_REACH_M = 350;      // ...or this close to a node where roads carry on (Silk Board's Hosur Road arm)
const MERGE_GAP_M = 9;         // the clear road a turning vehicle needs on either side of where it joins

function kindAt(r: number): Kind {
  let acc = 0;
  for (const k of KINDS) {
    acc += k.share;
    if (r <= acc) return k;
  }
  return KINDS[1];
}

/**
 * The network as the simulation sees it: each road's length in plane units, its metres per unit, the lanes
 * each lane leads into, and the junctions with traffic lights and their stop lines. A junction is where two
 * differently named roads meet end to end, where a road ends within 60 m of another road partway along it
 * (a side street on the Outer Ring Road), or where a road ends within 350 m of a node where roads carry on
 * (Hosur Road at Silk Board).
 */
export function buildNetwork(roads: SimRoad[], signals = true) {
  const cum = roads.map((r) => {
    const c = [0];
    for (let i = 1; i < r.pts.length; i++) c.push(c[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
    return c;
  });
  /** Metres per plane unit, per road. */
  const mpu = roads.map((r, i) => r.lengthM / (cum[i][cum[i].length - 1] || 1));
  /** The nearest point of a road to a plane point: its distance and how far along the road it lies. */
  const nearest = (ri: number, x: number, y: number) => {
    const p = roads[ri].pts;
    const c = cum[ri];
    let dist = Infinity;
    let along = 0;
    for (let i = 1; i < p.length; i++) {
      const ax = p[i - 1][0];
      const ay = p[i - 1][1];
      const dx = p[i][0] - ax;
      const dy = p[i][1] - ay;
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2));
      const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
      if (d < dist) {
        dist = d;
        along = c[i - 1] + t * Math.sqrt(l2);
      }
    }
    return { dist, along };
  };

  // ---- graph: lanes, where each one leads, and the traffic lights on them ----
  const laneKey = (road: number, dir: number) => road * 2 + (dir > 0 ? 0 : 1);
  const touching = new Map<string, { road: number; dir: 1 | -1 }[]>(); // dir: leaving the node
  const nodeAt = new Map<string, [number, number]>();
  roads.forEach((r, i) => {
    (touching.get(r.fromNode) ?? touching.set(r.fromNode, []).get(r.fromNode)!).push({ road: i, dir: 1 });
    (touching.get(r.toNode) ?? touching.set(r.toNode, []).get(r.toNode)!).push({ road: i, dir: -1 });
    nodeAt.set(r.fromNode, r.pts[0]);
    nodeAt.set(r.toNode, r.pts[r.pts.length - 1]);
  });
  const exits = new Map<number, Exit[]>();
  const addExit = (road: number, dir: 1 | -1, e: Exit) => {
    const key = laneKey(road, dir);
    (exits.get(key) ?? exits.set(key, []).get(key)!).push(e);
  };
  roads.forEach((r, ri) => {
    for (const dir of [1, -1] as const) {
      const node = dir > 0 ? r.toNode : r.fromNode;
      for (const o of touching.get(node) ?? []) if (o.road !== ri) addExit(ri, dir, { road: o.road, dir: o.dir, s0: 0 });
    }
  });

  const junctions: { offset: number }[] = [];
  const stops: Stop[] = [];
  const laneStops = new Map<number, Stop[]>();
  const newJunction = () => junctions.push({ offset: Math.random() * CYCLE }) - 1;
  const addStop = (road: number, dir: 1 | -1, s: number, junction: number, group: 0 | 1) => {
    if (s < 10 || s > roads[road].lengthM) return;
    const st = { road, dir, s, junction, group };
    stops.push(st);
    const key = laneKey(road, dir);
    (laneStops.get(key) ?? laneStops.set(key, []).get(key)!).push(st);
  };
  // the lanes running into a node
  const intoNode = (node: string) => (touching.get(node) ?? []).map((o) => ({ road: o.road, dir: -o.dir as 1 | -1 }));

  if (signals) {
    const nodeJunction = new Map<string, number>();
    // two differently named roads meeting end to end (Inner Ring Road and 80 Feet Road at Sony World)
    for (const [node, list] of touching) {
      if (list.length < 2) continue;
      const names = [...new Set(list.map((o) => roads[o.road].name))];
      if (names.length < 2) continue;
      const j = newJunction();
      nodeJunction.set(node, j);
      for (const a of intoNode(node)) addStop(a.road, a.dir, roads[a.road].lengthM - 14, j, roads[a.road].name === names[0] ? 0 : 1);
    }
    // a road that ends on another: partway along it (a side street on the Outer Ring Road), or near a
    // node where roads carry on
    roads.forEach((side, si) => {
      for (const end of [
        { node: side.fromNode, dir: -1 as const },
        { node: side.toNode, dir: 1 as const },
      ]) {
        if ((touching.get(end.node)?.length ?? 0) !== 1) continue;
        const [x, y] = nodeAt.get(end.node)!;
        let hit: { ri: number; dM: number; alongM: number } | null = null;
        for (let ri = 0; ri < roads.length; ri++) {
          if (ri === si) continue;
          const n = nearest(ri, x, y);
          const dM = n.dist * mpu[ri];
          if (!hit || dM < hit.dM) hit = { ri, dM, alongM: n.along * mpu[ri] };
        }
        if (hit && hit.dM <= SIDE_REACH_M && hit.alongM > 40 && hit.alongM < roads[hit.ri].lengthM - 40) {
          const main = roads[hit.ri];
          const j = newJunction();
          addStop(si, end.dir, side.lengthM - 8, j, 1);
          addStop(hit.ri, 1, hit.alongM - 14, j, 0);
          addStop(hit.ri, -1, main.lengthM - hit.alongM - 14, j, 0);
          addExit(si, end.dir, { road: hit.ri, dir: 1, s0: hit.alongM + 4 });
          addExit(si, end.dir, { road: hit.ri, dir: -1, s0: main.lengthM - hit.alongM + 4 });
          continue;
        }
        let close: { node: string; dM: number } | null = null;
        for (const [node, list] of touching) {
          if (list.length < 2) continue;
          const [nx, ny] = nodeAt.get(node)!;
          const dM = Math.hypot(nx - x, ny - y) * mpu[si];
          if (!close || dM < close.dM) close = { node, dM };
        }
        if (close && close.dM <= NODE_REACH_M) {
          let j = nodeJunction.get(close.node);
          if (j === undefined) {
            j = newJunction();
            nodeJunction.set(close.node, j);
            for (const a of intoNode(close.node)) addStop(a.road, a.dir, roads[a.road].lengthM - 14, j, 0);
          }
          addStop(si, end.dir, side.lengthM - 8, j, 1);
          for (const o of touching.get(close.node)!) addExit(si, end.dir, { road: o.road, dir: o.dir, s0: 0 });
        }
      }
    });
    for (const list of laneStops.values()) list.sort((a, b) => a.s - b.s);
  }

  return { cum, mpu, exits, laneKey, stops, laneStops, junctions };
}

export interface TrafficView {
  canvas: HTMLCanvasElement;
  /** The part of the plane this canvas shows, in plane units: its left, top and width (default: all of it). */
  window?: { x: number; y: number; w: number };
  /** Lane offset from the centre line, in plane units. */
  laneOffset?: number;
  /** Simulated seconds of open shutter: a streak is how far a vehicle goes in it. */
  exposure?: number;
  /** Scales every light, for a smaller or closer view. */
  lightScale?: number;
  /**
   * Draws through a camera instead of the flat window: a plane point to CSS pixels on the canvas, or null
   * when it is off the picture. Used to lay the traffic over a tilted map.
   */
  project?: (x: number, y: number) => [number, number] | null;
}

export interface TrafficOptions {
  /** Plane width in units. */
  planeWidth: number;
  /** Simulated seconds per real second. */
  timeScale?: number;
  /** The direction that faces the camera, in plane units (headlights point this way). */
  towardCamera?: [number, number];
  /** Run traffic lights at the junctions (on by default). */
  signals?: boolean;
  reduce?: boolean;
}

export interface TrafficControl {
  setPaused(p: boolean): void;
  /** Draw the current picture again: a still whose inputs changed. */
  redraw(): void;
  stop(): void;
}

interface Out {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  x0: number;
  y0: number;
  w: number;
  scale: number;
  laneOffset: number;
  exposure: number;
  lightScale: number;
  project?: (x: number, y: number) => [number, number] | null;
}

/**
 * Runs one simulation and draws it into every view: the whole network on one canvas, a close-up of one
 * junction on another, each the same vehicles at the same moment.
 */
export function startTraffic(views: TrafficView[], roads: SimRoad[], read: () => Record<string, RoadNow> | null, opts: TrafficOptions): TrafficControl {
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  const outs: Out[] = [];
  for (const v of views) {
    const ctx = v.canvas.getContext('2d');
    if (!ctx) continue;
    outs.push({
      canvas: v.canvas,
      ctx,
      x0: v.window?.x ?? 0,
      y0: v.window?.y ?? 0,
      w: v.window?.w ?? opts.planeWidth,
      scale: 1,
      laneOffset: v.laneOffset ?? 2.4,
      exposure: v.exposure ?? 20,
      lightScale: v.lightScale ?? 1,
      project: v.project,
    });
  }
  if (!outs.length) return { setPaused() {}, redraw() {}, stop() {} };
  const timeScale = opts.timeScale ?? 18;
  const toward = opts.towardCamera ?? [0.28, 0.96];
  let ready = false;
  let running = false;
  const fit = (o: Out) => {
    o.scale = (o.canvas.offsetWidth / o.w) * dpr;
    const w = Math.round(o.canvas.offsetWidth * dpr);
    const h = Math.round(o.canvas.offsetHeight * dpr);
    if (w === o.canvas.width && h === o.canvas.height) return;
    o.canvas.width = w;
    o.canvas.height = h;
    // resizing a canvas clears it: put the picture back when no frame loop will (a still, or paused)
    if (ready && !running) drawView(o);
  };
  outs.forEach(fit);
  const ro =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver((entries) => {
          for (const e of entries) {
            const o = outs.find((q) => q.canvas === e.target);
            if (o) fit(o);
          }
        })
      : null;
  for (const o of outs) ro?.observe(o.canvas);

  // ---- the network, and where each lane's metres fall on the plane ----
  const { cum, exits, laneKey, stops, laneStops, junctions } = buildNetwork(roads, opts.signals !== false);
  const pickNext = (road: number, dir: 1 | -1) => {
    const options = exits.get(laneKey(road, dir));
    return options?.length ? options[Math.floor(Math.random() * options.length)] : null;
  };
  const at = (ri: number, dir: 1 | -1, sM: number, off: number): [number, number, number, number] => {
    const r = roads[ri];
    const c = cum[ri];
    const total = c[c.length - 1];
    const u = Math.min(1, Math.max(0, sM / r.lengthM));
    const d = (dir > 0 ? u : 1 - u) * total;
    let lo = 0;
    let hi = c.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= d) lo = mid;
      else hi = mid;
    }
    const seg = c[hi] - c[lo] || 1;
    const k = (d - c[lo]) / seg;
    const a = r.pts[lo];
    const b = r.pts[hi];
    let hx = (b[0] - a[0]) / seg;
    let hy = (b[1] - a[1]) / seg;
    if (dir < 0) {
      hx = -hx;
      hy = -hy;
    }
    // keep left: the lane sits to the left of the direction of travel
    return [a[0] + (b[0] - a[0]) * k + hy * off, a[1] + (b[1] - a[1]) * k - hx * off, hx, hy];
  };
  let simT = 0;
  /** 0 green, 1 amber, 2 red. */
  const light = (j: number, group: 0 | 1) => {
    const t = (simT + junctions[j].offset) % CYCLE;
    const [g, a, r] = PLAN[group];
    return t >= g && t < a ? 0 : t >= a && t < r ? 1 : 2;
  };

  // ---- the live picture: target speed and count per lane ----
  const targetKph = (ri: number) => {
    const live = read()?.[roads[ri].id];
    return Math.max(5, live?.kph ?? roads[ri].freeFlowKph * 0.92);
  };
  const targetCount = (ri: number) => {
    const live = read()?.[roads[ri].id];
    const density = live?.densityPerKm ?? DEFAULT_DENSITY;
    return Math.max(1, Math.round((density * (roads[ri].lengthM / 1000) * VISIBLE_SHARE) / 2));
  };

  const lanes = new Map<number, Vehicle[]>();
  const vehicles: Vehicle[] = [];

  const spawn = (road: number, dir: 1 | -1, s: number, warm: boolean) => {
    const kind = kindAt(Math.random());
    const v0 = Math.min(kind.maxKph, targetKph(road)) / 3.6;
    vehicles.push({
      road,
      dir,
      s,
      v: v0 * (0.6 + Math.random() * 0.3),
      acc: 0,
      kind,
      drive: 0.85 + Math.random() * 0.3,
      next: pickNext(road, dir),
      prev: null,
      entry: 0,
      cool: kind.name === 'car' && Math.random() < 0.55,
      fade: warm ? 1 : 0,
      leaving: false,
    });
  };

  // start with every lane at its target, in random places along the road
  roads.forEach((r, ri) => {
    for (const dir of [1, -1] as const) {
      const n = targetCount(ri);
      const at0 = Array.from({ length: n }, () => Math.random() * r.lengthM).sort((a, b) => a - b);
      for (let i = 0; i < n; i++) spawn(ri, dir, at0[i], true);
    }
  });

  const sortLanes = () => {
    lanes.clear();
    for (const v of vehicles) {
      const key = laneKey(v.road, v.dir);
      (lanes.get(key) ?? lanes.set(key, []).get(key)!).push(v);
    }
    for (const lane of lanes.values()) lane.sort((a, b) => b.s - a.s);
  };

  /** Is the stretch of a lane round `s0` clear enough to turn into? */
  const clearAt = (road: number, dir: 1 | -1, s0: number) => {
    for (const o of lanes.get(laneKey(road, dir)) ?? []) if (o.s > s0 - MERGE_GAP_M && o.s - o.kind.lengthM < s0 + MERGE_GAP_M) return false;
    return true;
  };

  const step = (h: number) => {
    simT += h;
    sortLanes();

    for (const [key, lane] of lanes) {
      const signals = laneStops.get(key);
      for (let i = 0; i < lane.length; i++) {
        const me = lane[i];
        const road = roads[me.road];
        const v0 = (Math.min(me.kind.maxKph, targetKph(me.road)) / 3.6) * me.drive;
        // the vehicle ahead: on this lane, else the first one past where it will join the next lane
        let gap = Infinity;
        let leadV = me.v;
        const ahead = lane[i - 1];
        if (ahead) {
          gap = ahead.s - ahead.kind.lengthM - me.s;
          leadV = ahead.v;
        } else if (me.next) {
          const nl = lanes.get(laneKey(me.next.road, me.next.dir));
          if (nl) {
            for (let k = nl.length - 1; k >= 0; k--) {
              if (nl[k].s < me.next.s0) continue;
              gap = road.lengthM - me.s + nl[k].s - me.next.s0 - nl[k].kind.lengthM;
              leadV = nl[k].v;
              break;
            }
          }
        }
        // a red light ahead is a standing vehicle at the stop line; on amber, stop if there is room to
        if (signals) {
          for (const st of signals) {
            if (st.s <= me.s - 0.5) continue;
            const state = light(st.junction, st.group);
            const dist = st.s - me.s;
            if ((state === 2 || (state === 1 && dist > (me.v * me.v) / (2 * COMFORT_BRAKE))) && dist < gap) {
              gap = Math.max(0.1, dist);
              leadV = 0;
            }
            break;
          }
        }
        // IDM acceleration
        const dv = me.v - leadV;
        const sStar = MIN_GAP + Math.max(0, me.v * me.kind.headway + (me.v * dv) / (2 * Math.sqrt(me.kind.accel * COMFORT_BRAKE)));
        let a = me.kind.accel * (1 - Math.pow(me.v / Math.max(0.5, v0), 4) - (gap === Infinity ? 0 : Math.pow(sStar / Math.max(0.5, gap), 2)));
        a += (Math.random() - 0.5) * 0.5; // drivers are not machines: small noise seeds the waves
        me.acc = Math.max(-7, Math.min(me.kind.accel, a));
        me.v = Math.max(0, me.v + me.acc * h);
        me.s += me.v * h;
      }
    }

    // leave a road: carry on where the network continues (a turn waits for a gap in the traffic it joins),
    // else turn off the network (fade out)
    for (const v of vehicles) {
      const len = roads[v.road].lengthM;
      if (v.leaving || v.s < len) continue;
      const nx = v.next;
      const over = nx ? (lanes.get(laneKey(nx.road, nx.dir))?.length ?? 0) > targetCount(nx.road) * 1.2 : true;
      if (!nx || over) {
        v.leaving = true;
        v.s = len;
        continue;
      }
      if (nx.s0 > 0 && !clearAt(nx.road, nx.dir, nx.s0)) {
        v.s = len - 0.01;
        v.v = 0;
        continue;
      }
      v.prev = { road: v.road, dir: v.dir };
      v.s = nx.s0 + (v.s - len);
      v.entry = nx.s0;
      v.road = nx.road;
      v.dir = nx.dir;
      v.next = pickNext(v.road, v.dir);
    }

    // join a road: a new vehicle turns on at the start of any lane short of its count, when there is room.
    // Arrivals are random (a Poisson stream, about one every four seconds while the lane wants more), so
    // gaps vary and platoons form behind slower drivers instead of an even string of lights.
    roads.forEach((_, ri) => {
      for (const dir of [1, -1] as const) {
        const lane = lanes.get(laneKey(ri, dir)) ?? [];
        if (lane.length >= targetCount(ri)) continue;
        const tail = lane[lane.length - 1];
        if (tail && tail.s < 12) continue;
        if (Math.random() < h / 4) spawn(ri, dir, 0, false);
      }
    });
  };

  // ---- drawing: a long exposure, redrawn whole every frame ----
  // A moving vehicle leaves a streak as long as the distance it covers while the shutter is open, bright at
  // the lamp and fading behind it; a stopped one is a point. Queues read as rows of red points, free roads
  // as long ribbons of light, the way a night photograph of a city shows them.
  const sprite = (inner: string, outer: string) => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.18, outer);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return c;
  };
  const LAMP = {
    warm: { glow: sprite('rgba(255,250,236,1)', 'rgba(255,214,150,0.55)'), rgb: '255,222,170' },
    cool: { glow: sprite('rgba(249,249,249,1)', 'rgba(190,215,255,0.55)'), rgb: '214,230,255' },
    tail: { glow: sprite('rgba(255,170,150,1)', 'rgba(255,40,30,0.6)'), rgb: '255,52,40' },
    brake: { glow: sprite('rgba(255,226,214,1)', 'rgba(255,36,26,0.85)'), rgb: '255,70,52' },
  };
  // the signal heads: green, amber, red
  const SIGNAL = [
    sprite('rgba(214,255,230,1)', 'rgba(40,220,120,0.75)'),
    sprite('rgba(255,244,210,1)', 'rgba(250,178,25,0.8)'),
    sprite('rgba(255,214,210,1)', 'rgba(240,40,40,0.8)'),
  ];

  // a point `back` metres behind the vehicle, round onto the road it came from when the streak is longer
  // than its time on this one
  const behind = (v: Vehicle, back: number, off: number) => {
    const s = v.s - back;
    if (s >= v.entry || !v.prev) return at(v.road, v.dir, Math.max(v.entry, s), off);
    return at(v.prev.road, v.prev.dir, Math.max(0, roads[v.prev.road].lengthM + s - v.entry), off);
  };

  const drawView = (o: Out) => {
    const { ctx, canvas, scale, x0, y0, laneOffset, exposure, lightScale, project } = o;
    // through a camera, a point off the picture comes back as null; it is drawn far outside and skipped
    const P = project
      ? (x: number, y: number): [number, number] => {
          const p = project(x, y);
          return p ? [p[0] * dpr, p[1] * dpr] : [-1e6, -1e6];
        }
      : (x: number, y: number): [number, number] => [(x - x0) * scale, (y - y0) * scale];
    const margin = 60 * dpr;
    const outside = (px: number, py: number) => px < -margin || py < -margin || px > canvas.width + margin || py > canvas.height + margin;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    // the traffic lights, at the kerb beside each stop line
    const head = 4.6 * lightScale * dpr;
    ctx.globalAlpha = 0.95;
    for (const st of stops) {
      const [x, y] = at(st.road, st.dir, st.s, laneOffset * 2.1);
      const [sx, sy] = P(x, y);
      if (outside(sx, sy)) continue;
      ctx.drawImage(SIGNAL[light(st.junction, st.group)], sx - head / 2, sy - head / 2, head, head);
    }

    for (const v of vehicles) {
      if (v.fade <= 0) continue;
      const [x, y, hx, hy] = at(v.road, v.dir, v.s, laneOffset);
      const [hx0, hy0] = P(x, y);
      if (outside(hx0, hy0)) continue;
      const towards = hx * toward[0] + hy * toward[1] > 0;
      const braking = !towards && v.acc < -1.2;
      const lamp = towards ? (v.cool ? LAMP.cool : LAMP.warm) : braking ? LAMP.brake : LAMP.tail;
      const k = v.kind.light * dpr * lightScale;
      const strength = v.fade * (towards ? 1 : braking ? 1 : 0.85);

      const len = v.v * exposure;
      if (len > 4) {
        // the streak: one path bending with the road, bright at the lamp and gone at its tail, stroked
        // twice: a wide faint pass for the bloom a camera sees round a light, then the light itself
        const path = new Path2D();
        path.moveTo(hx0, hy0);
        let tx = hx0;
        let ty = hy0;
        for (let i = 1; i <= STREAK_STEPS; i++) {
          const [bx, by] = behind(v, (len * i) / STREAK_STEPS, laneOffset);
          [tx, ty] = P(bx, by);
          path.lineTo(tx, ty);
        }
        const g = ctx.createLinearGradient(hx0, hy0, tx, ty);
        g.addColorStop(0, `rgba(${lamp.rgb},1)`);
        g.addColorStop(0.4, `rgba(${lamp.rgb},0.45)`);
        g.addColorStop(1, `rgba(${lamp.rgb},0)`);
        ctx.strokeStyle = g;
        const w = (towards ? 1.5 : 1.25) * k;
        ctx.globalAlpha = strength * 0.2;
        ctx.lineWidth = w * 3.6;
        ctx.stroke(path);
        ctx.globalAlpha = strength;
        ctx.lineWidth = w;
        ctx.stroke(path);
      }
      const size = (towards ? 5.5 : braking ? 7.5 : 4.2) * k;
      ctx.globalAlpha = strength;
      ctx.drawImage(lamp.glow, hx0 - size / 2, hy0 - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  };
  const draw = () => outs.forEach(drawView);

  // ---- the loop ----
  let raf = 0;
  let last = 0;
  let carry = 0;
  const frame = (now: number) => {
    raf = 0;
    if (!running) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    carry += dt * timeScale;
    let n = 0;
    while (carry >= SIM_STEP && n < 12) {
      step(SIM_STEP);
      carry -= SIM_STEP;
      n++;
    }
    for (let i = vehicles.length - 1; i >= 0; i--) {
      const v = vehicles[i];
      v.fade = v.leaving ? v.fade - dt * 3 : Math.min(1, v.fade + dt * 2.5);
      if (v.fade <= 0) vehicles.splice(i, 1);
    }
    draw();
    raf = requestAnimationFrame(frame);
  };
  let paused = false;
  // the loop runs while any view is on screen and the tab is showing
  const onScreen = new Set<Element>();
  let visible = true;
  const start = () => {
    if (running || opts.reduce || paused || !visible) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  };
  const stopLoop = () => {
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
  };

  /** Run the simulation forward without drawing, to the state it settles into. */
  const settle = (seconds: number) => {
    for (let t = 0; t < seconds; t += SIM_STEP) step(SIM_STEP);
    for (let i = vehicles.length - 1; i >= 0; i--) if (vehicles[i].leaving) vehicles.splice(i, 1);
    for (const v of vehicles) v.fade = 1;
  };

  ready = true;
  if (opts.reduce) {
    // a still: one long exposure of the traffic as it stands, two minutes into its signal cycles
    settle(120);
    draw();
  }

  const io =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          for (const e of entries) {
            if (e.isIntersecting) onScreen.add(e.target);
            else onScreen.delete(e.target);
          }
          visible = onScreen.size > 0 && !document.hidden;
          if (visible) start();
          else stopLoop();
        })
      : null;
  for (const o of outs) io?.observe(o.canvas);
  const vis = () => {
    visible = (!io || onScreen.size > 0) && !document.hidden;
    if (visible) start();
    else stopLoop();
  };
  document.addEventListener('visibilitychange', vis);
  if (!io) start();

  return {
    setPaused(p: boolean) {
      paused = p;
      if (p) stopLoop();
      else start();
    },
    redraw() {
      if (running) return;
      // a still under reduced motion follows its inputs: let the traffic settle to them, then draw it
      if (opts.reduce) settle(60);
      draw();
    },
    stop() {
      stopLoop();
      io?.disconnect();
      ro?.disconnect();
      document.removeEventListener('visibilitychange', vis);
    },
  };
}
