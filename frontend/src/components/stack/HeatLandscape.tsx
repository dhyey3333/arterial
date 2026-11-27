import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import { useReducedMotion, type MotionValue } from 'motion/react';
import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import * as THREE from 'three';

/**
 * The week as a landscape: one bar per segment and hour, its height the share of that hour the segment
 * spent heavy or severe. Hours run left to right, the most congested segment stands at the back, so the
 * morning and evening peaks rise as two ridges across the city, which the flat grid shows only as two
 * darker bands. Hovering a bar names the road, the hour and the share; drag to turn it.
 *
 * The bars rise once on open, in a wave across the hours (not under reduced motion), then the scene renders
 * only on change. Colours come from the same graphite-to-off-white ramp as the flat grid. Labels and the tooltip are DOM over
 * the canvas, moved by projecting their anchors each rendered frame.
 *
 * On the landing page it is driven by the scroll instead of the pointer: `play` holds the rise until the
 * section is in view, and `turn` (-1 to 1) swings the camera round the landscape and a little higher as the
 * page moves past, so the ridges read as depth without a drag that would fight the page's own scrolling.
 */

const HOURS = 24;
const STEP_X = 0.34; // scene units per hour
const STEP_Z = 0.44; // scene units per segment
const BAR_X = 0.26;
const BAR_Z = 0.34;
const H_MAX = 2.6; // height of a 100% bar
const FLOOR = 0.015; // a no-congestion hour still shows as a tile

// the ramp of the flat grid (tokens.css --seq-0 to --seq-5), low to high
const RAMP = ['#17171a', '#2a2a2e', '#45454b', '#6c6c73', '#a3a3a9', '#f2f2f3'].map((c) => new THREE.Color(c));
const HOVER = new THREE.Color('#ffffff');

function rampColor(v: number, out: THREE.Color) {
  const x = Math.min(1, Math.max(0, v)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  return out.copy(RAMP[i]).lerp(RAMP[i + 1], x - i);
}

export type LandscapeProps = {
  /** Segment ids, most congested first. */
  rows: string[];
  name: (id: string) => string;
  value: (row: string, hour: number) => number | null;
  formatHour: (h: number) => string;
  formatValue: (v: number) => string;
  /** Hold the rise until this turns true. */
  play?: boolean;
  /** Turn the camera with this value, -1 to 1, in place of drag controls. */
  turn?: MotionValue<number>;
};

type Cell = { row: number; hour: number; v: number };

const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

function Bars({ cells, rows, still, play, hovered, onHover }: { cells: Cell[]; rows: number; still: boolean; play: boolean; hovered: number | null; onHover: (i: number | null) => void }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const t = useRef(still ? 10 : 0);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const c = useMemo(() => new THREE.Color(), []);
  const width = HOURS * STEP_X;
  const depth = rows * STEP_Z;

  const place = (k: (cell: Cell) => number) => {
    const g = mesh.current;
    if (!g) return;
    cells.forEach((cell, i) => {
      const h = Math.max(FLOOR, cell.v * H_MAX * k(cell));
      const x = -width / 2 + (cell.hour + 0.5) * STEP_X;
      const z = -depth / 2 + (cell.row + 0.5) * STEP_Z;
      m.makeScale(BAR_X, h, BAR_Z).setPosition(x, h / 2, z);
      g.setMatrixAt(i, m);
    });
    g.instanceMatrix.needsUpdate = true;
    // hit-testing uses a cached bounding sphere: drop it whenever the bars move, so hover finds tall bars
    g.boundingSphere = null;
  };

  // colours: the ramp, the hovered bar lit
  useLayoutEffect(() => {
    const g = mesh.current;
    if (!g) return;
    cells.forEach((cell, i) => g.setColorAt(i, i === hovered ? HOVER : rampColor(cell.v, c)));
    if (g.instanceColor) g.instanceColor.needsUpdate = true;
  }, [cells, hovered, c]);

  useLayoutEffect(() => {
    place(() => (t.current > 2.5 ? 1 : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells]);

  // the scene renders on demand: ask for the first frame of the rise once it may start
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (play) invalidate();
  }, [play, invalidate]);

  // the rise: a wave across the hours, each bar easing out over half a second
  useFrame((state, delta) => {
    if (t.current > 2.5 || !play) return;
    t.current += delta;
    place((cell) => easeOut((t.current - cell.hour * 0.035 - cell.row * 0.012) / 0.55));
    state.invalidate();
  });

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, cells.length]}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        if (e.instanceId !== undefined && e.instanceId !== hovered) onHover(e.instanceId);
      }}
      onPointerOut={() => onHover(null)}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial />
    </instancedMesh>
  );
}

/** The floor: a hairline frame and a rule every three hours, so the hours read without a label on each bar. */
function Floor({ rows }: { rows: number }) {
  const w = HOURS * STEP_X;
  const d = rows * STEP_Z;
  const frame = useMemo<[number, number, number][]>(
    () => [
      [-w / 2, 0, -d / 2],
      [w / 2, 0, -d / 2],
      [w / 2, 0, d / 2],
      [-w / 2, 0, d / 2],
      [-w / 2, 0, -d / 2],
    ],
    [w, d],
  );
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.003, 0]}>
        <planeGeometry args={[w + 0.3, d + 0.3]} />
        <meshBasicMaterial color="#121214" />
      </mesh>
      <Line points={frame} color="#ffffff" lineWidth={1} transparent opacity={0.12} toneMapped={false} />
      {Array.from({ length: HOURS / 3 - 1 }, (_, i) => {
        const x = -w / 2 + (i + 1) * 3 * STEP_X;
        return <Line key={i} points={[[x, 0.001, -d / 2], [x, 0.001, d / 2]]} color="#ffffff" lineWidth={1} transparent opacity={0.06} toneMapped={false} />;
      })}
    </>
  );
}

function Project({ rows, labels, tipAnchor, tip }: { rows: number; labels: RefObject<(HTMLElement | null)[]>; tipAnchor: [number, number, number] | null; tip: RefObject<HTMLElement | null> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  const w = HOURS * STEP_X;
  const d = rows * STEP_Z;
  useFrame(({ camera, size }) => {
    const put = (el: HTMLElement | null | undefined, x: number, y: number, z: number) => {
      if (!el) return 0;
      v.set(x, y, z).project(camera);
      const px = ((v.x + 1) / 2) * size.width;
      el.style.transform = `translate(${px}px, ${((1 - v.y) / 2) * size.height}px)`;
      return px;
    };
    // an hour label every three hours, along the front edge; one whose hours are out of the picture (a
    // narrow screen crops the ends) hides rather than hang half off the edge
    labels.current.forEach((el, i) => {
      const px = put(el, -w / 2 + (i * 3 + 0.5) * STEP_X, 0, d / 2 + 0.3);
      if (el) el.style.visibility = px < 16 || px > size.width - 16 ? 'hidden' : '';
    });
    if (tipAnchor && tip.current) put(tip.current, ...tipAnchor);
  });
  return null;
}

const CAMERA: [number, number, number] = [2.6, 4.8, 8.8];
const TARGET = new THREE.Vector3(0, H_MAX * 0.2, 0);
const TURN = 0.42; // radians either side at turn -1 and +1
const RAISE = 0.12; // radians higher at turn +1

function FitCamera({ radius, turn }: { radius: number; turn?: MotionValue<number> }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; minDistance: number; maxDistance: number; update: () => void } | null;
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    // the bounding sphere is generous (most bars are low), so the scroll-turned view can sit closer on a wide
    // stage; a narrow one is limited by its width, where the swing needs the room
    const fit = turn ? THREE.MathUtils.clamp(1.04 - 0.22 * aspect, 0.6, 0.86) : 0.74;
    const dist = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * fit;
    if (turn) {
      // round the landscape from the resting view: further round and a little higher as the value grows
      const base = new THREE.Spherical().setFromVector3(new THREE.Vector3(...CAMERA).sub(TARGET));
      const s = new THREE.Spherical();
      const put = (v: number) => {
        s.set(dist, THREE.MathUtils.clamp(base.phi - v * RAISE, 0.3, 1.3), base.theta + v * TURN);
        camera.position.setFromSpherical(s).add(TARGET);
        camera.lookAt(TARGET);
        camera.updateProjectionMatrix();
        invalidate();
      };
      put(turn.get());
      return turn.on('change', put);
    }
    const target = controls?.target ?? TARGET;
    const dir = camera.position.clone().sub(target).normalize();
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.minDistance = dist * 0.55;
      controls.maxDistance = dist * 1.5;
      controls.update();
    }
    invalidate();
  }, [size.width, size.height, camera, controls, radius, invalidate, turn]);
  return null;
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <Unavailable /> : this.props.children;
  }
}

function Unavailable() {
  return (
    <div className="stk__fallback">
      <p className="stk__fallback-title">The landscape could not start</p>
      <p>It needs WebGL. The grid shows the same hours.</p>
    </div>
  );
}

export default function HeatLandscape({ rows, name, value, formatHour, formatValue, play = true, turn }: LandscapeProps) {
  const still = !!useReducedMotion();
  const [hovered, setHovered] = useState<number | null>(null);
  const labels = useRef<(HTMLElement | null)[]>([]);
  const tip = useRef<HTMLDivElement | null>(null);

  // the most congested segment at the back, so tall bars never hide the rows in front of them
  const cells = useMemo(() => {
    const out: Cell[] = [];
    rows.forEach((id, r) => {
      for (let hour = 0; hour < HOURS; hour++) out.push({ row: r, hour, v: value(id, hour) ?? 0 });
    });
    return out;
  }, [rows, value]);

  const cell = hovered !== null ? cells[hovered] : null;
  const w = HOURS * STEP_X;
  const d = rows.length * STEP_Z;
  const tipAnchor: [number, number, number] | null = cell ? [-w / 2 + (cell.hour + 0.5) * STEP_X, Math.max(FLOOR, cell.v * H_MAX) + 0.08, -d / 2 + (cell.row + 0.5) * STEP_Z] : null;

  return (
    <div
      className={`stk hl ${turn ? 'hl--scroll' : ''} ${hovered !== null ? 'is-pointing' : ''}`}
      role="group"
      aria-label={`The week as a landscape: one bar per segment and hour, its height the share of that hour spent heavy or severe. Hours run left to right, the most congested segment at the back. ${turn ? 'It turns as the page scrolls.' : 'Drag to turn it.'} The grid view shows the same values as a table.`}
    >
      <Boundary>
        <Canvas dpr={[1, 2]} frameloop="demand" flat camera={{ position: CAMERA, fov: 32 }} gl={{ antialias: true }} fallback={<Unavailable />} onPointerMissed={() => setHovered(null)}>
          <ambientLight intensity={1} />
          <directionalLight position={[4, 8, 6]} intensity={1.5} />
          <directionalLight position={[-6, 3, -4]} intensity={0.25} />
          <Floor rows={rows.length} />
          <Bars cells={cells} rows={rows.length} still={still} play={play} hovered={hovered} onHover={setHovered} />
          <Project rows={rows.length} labels={labels} tipAnchor={tipAnchor} tip={tip} />
          <FitCamera radius={Math.hypot(w / 2 + 0.3, d / 2 + 0.3, H_MAX / 2)} turn={turn} />
          {!turn && <OrbitControls makeDefault target={[0, H_MAX * 0.2, 0]} enablePan={false} enableDamping={!still} minPolarAngle={0.25} maxPolarAngle={1.3} />}
        </Canvas>

        <div className="stk__overlay" aria-hidden="true">
          {Array.from({ length: HOURS / 3 }, (_, i) => (
            <span
              key={i}
              ref={(el) => {
                labels.current[i] = el;
              }}
              className="hl__hour num"
            >
              {formatHour(i * 3)}
            </span>
          ))}
          {cell && (
            <div className="stk__tip hl__tip" ref={tip}>
              <p className="stk__tip-name">
                {name(rows[cell.row])} <span className="mono">{rows[cell.row]}</span>
              </p>
              <p className="hl__tip-line num">
                {formatHour(cell.hour)} · {formatValue(cell.v)} of the hour heavy or severe
              </p>
            </div>
          )}
        </div>
      </Boundary>
    </div>
  );
}
