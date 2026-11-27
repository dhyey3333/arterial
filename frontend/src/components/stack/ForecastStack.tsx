import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import { useReducedMotion } from 'motion/react';
import { Component, useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import * as THREE from 'three';
import type { SegmentLevel } from '../../lib/contract';
import { LEVEL_LABEL, fmtSpeed } from '../../lib/format';
import { useLive } from '../../data/store';
import { toPlane } from '../../landing/geometry';
import { LEVEL_WIDTH, levelCss } from '../map/levels';

/**
 * The forecast as a space-time stack: the road network drawn four times, now at the bottom and 5, 10
 * and 15 minutes ahead above it, each road coloured by its level at that moment. A jam that spreads
 * shows as colour climbing the stack and leaning across it, which the 2D map can only show one horizon
 * at a time. Hovering a road (here or in the list) lights it through all four layers with a time
 * column and its levels; clicking selects it, as on the map.
 *
 * It renders only on change (frameloop "demand"), uses the maps' own colours and width steps without
 * tone mapping, and the layers rise into place once on open (not under reduced motion). Labels and the
 * tooltip are ordinary DOM over the canvas, moved by projecting their 3D anchors each rendered frame.
 */

const LAYERS = [0, 5, 10, 15] as const;
const GAP = 0.9; // scene units between two layers
const SIZE = 6; // scene width of the network
const LIFT = (LAYERS.length - 1) * GAP;

type Props = {
  horizon: number;
  selected: string | null;
  hovered: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
};

type Road = { id: string; name: string; pts: [number, number, number][]; mid: [number, number, number] };
type LevelsAt = Record<number, Record<string, { level: SegmentLevel; kph: number | null }>>;

function useRoads() {
  const network = useLive((s) => s.network);
  return useMemo(() => {
    const plane = toPlane(network);
    const k = SIZE / plane.w;
    const depth = plane.h * k;
    const roads: Road[] = plane.segments.map((s) => {
      // every other resampled point is plenty at this scale
      const pts = s.pts.filter((_, i) => i % 2 === 0 || i === s.pts.length - 1).map(([x, y]) => [x * k - SIZE / 2, 0, y * k - depth / 2] as [number, number, number]);
      return { id: s.id, name: s.name, pts, mid: pts[Math.floor(pts.length / 2)] };
    });
    return { roads, depth };
  }, [network]);
}

/** Each road's level at each layer: now from the latest window, ahead from the forecast. */
function useLevels() {
  const states = useLive((s) => s.states);
  const predictions = useLive((s) => s.predictions);
  return useMemo(() => {
    const at: LevelsAt = { 0: {}, 5: {}, 10: {}, 15: {} };
    for (const [id, st] of Object.entries(states)) at[0][id] = { level: st.level, kph: st.avg_speed_kph };
    for (const p of predictions?.predictions ?? []) if (at[p.horizon_min]) at[p.horizon_min][p.segment_id] = { level: p.predicted_level, kph: p.predicted_speed_kph };
    return { at, hasForecast: !!predictions?.predictions.length };
  }, [states, predictions]);
}

const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/** The four layers rise into place once, staggered, then the scene rests. */
function Rise({ groups, still }: { groups: RefObject<(THREE.Group | null)[]>; still: boolean }) {
  const t = useRef(still ? 10 : 0);
  useFrame((state, delta) => {
    if (t.current > 2) return;
    t.current += delta;
    groups.current.forEach((g, i) => {
      if (!g) return;
      const k = easeOut((t.current - i * 0.12) / 0.7);
      g.position.y = i * GAP * k;
      g.scale.setScalar(0.96 + 0.04 * k);
    });
    state.invalidate();
  });
  return null;
}

/**
 * Moves the DOM labels and tooltip to the screen positions of their 3D anchors on every rendered frame,
 * by writing transforms directly (no React state, so no re-render per frame).
 */
function Project({
  groups,
  labelAnchor,
  labels,
  tipAnchor,
  tip,
}: {
  groups: RefObject<(THREE.Group | null)[]>;
  labelAnchor: [number, number, number];
  labels: RefObject<(HTMLElement | null)[]>;
  tipAnchor: [number, number, number] | null;
  tip: RefObject<HTMLElement | null>;
}) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    const place = (el: HTMLElement | null | undefined, x: number, y: number, z: number) => {
      if (!el) return;
      v.set(x, y, z).project(camera);
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
    };
    groups.current.forEach((g, i) => place(labels.current[i], labelAnchor[0], g ? g.position.y : i * GAP, labelAnchor[2]));
    const el = tip.current;
    if (!tipAnchor || !el) return;
    if (size.width < 560) {
      // a narrow panel has no room beside the column: pin the tooltip under the view switch instead
      el.style.margin = '0';
      el.style.transform = 'translate(12px, 96px)';
    } else {
      el.style.margin = '';
      place(el, ...tipAnchor);
    }
  });
  return null;
}

function Layer({
  index,
  roads,
  depth,
  levels,
  focus,
  pointing,
  active,
  onHover,
  onSelect,
}: {
  index: number;
  roads: Road[];
  depth: number;
  levels: LevelsAt[number];
  focus: string | null;
  /** True while the pointer (or the list) is on a road: only then do the others step back. */
  pointing: boolean;
  active: boolean;
  onHover: Props['onHover'];
  onSelect: Props['onSelect'];
}) {
  const w = SIZE + 0.7;
  const d = depth + 0.7;
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
      {/* a sheet of dark glass under the roads, so the layers read as planes stacked in time */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.004, 0]} renderOrder={index * 3}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial color="#101010" transparent opacity={0.42} depthWrite={false} />
      </mesh>
      <Line points={frame} color={active ? '#f2f2f3' : '#ffffff'} lineWidth={active ? 1.4 : 1} transparent opacity={active ? 0.7 : 0.14} toneMapped={false} />
      {roads.map((r) => {
        const l = levels[r.id]?.level ?? 'no_data';
        const lit = focus === r.id;
        const dim = pointing && !lit;
        return (
          <Line
            key={r.id}
            points={r.pts}
            color={levelCss(l)}
            lineWidth={(lit ? 4.6 : 2.4) * LEVEL_WIDTH[l]}
            transparent
            opacity={dim ? 0.2 : active || index === 0 ? 1 : 0.62}
            toneMapped={false}
            renderOrder={index * 3 + 1}
            onPointerOver={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              onHover(r.id);
            }}
            onPointerOut={() => onHover(null)}
            onClick={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              onSelect(r.id);
            }}
          />
        );
      })}
    </>
  );
}

/** The road under focus as a column through time: a dashed line with a dot of its level at each layer. */
function Column({ road, at }: { road: Road; at: LevelsAt }) {
  const [x, , z] = road.mid;
  return (
    <>
      <Line points={[[x, 0, z], [x, LIFT, z]]} color="#f2f2f3" lineWidth={1.2} dashed dashSize={0.08} gapSize={0.06} transparent opacity={0.85} toneMapped={false} />
      {LAYERS.map((h, i) => (
        <mesh key={h} position={[x, i * GAP + 0.02, z]}>
          <sphereGeometry args={[0.06, 16, 12]} />
          <meshBasicMaterial color={levelCss(at[h][road.id]?.level ?? 'no_data')} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

/**
 * Keeps the whole stack in view whatever the panel's shape: on every resize it moves the camera along its
 * current direction to the distance at which the stack's bounding sphere fits the narrower field of view.
 */
function FitCamera({ radius }: { radius: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; minDistance: number; maxDistance: number; update: () => void } | null;
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const dist = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * 1.04;
    const target = controls?.target ?? new THREE.Vector3(0, LIFT / 2, 0);
    const dir = camera.position.clone().sub(target).normalize();
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.minDistance = dist * 0.55;
      controls.maxDistance = dist * 1.5;
      controls.update();
    }
    invalidate();
  }, [size.width, size.height, camera, controls, radius, invalidate]);
  return null;
}

function Scene({
  horizon,
  hovered,
  onSelect,
  onHover,
  still,
  roads,
  depth,
  at,
  focusRoad,
  groups,
  labels,
  tip,
}: Props & {
  still: boolean;
  roads: Road[];
  depth: number;
  at: LevelsAt;
  focusRoad: Road | null;
  groups: RefObject<(THREE.Group | null)[]>;
  labels: RefObject<(HTMLElement | null)[]>;
  tip: RefObject<HTMLElement | null>;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const focus = focusRoad?.id ?? null;
  return (
    <>
      <Rise groups={groups} still={still} />
      {LAYERS.map((h, i) => (
        <group
          key={h}
          ref={(g) => {
            groups.current[i] = g;
            if (g && still) g.position.y = i * GAP;
          }}
        >
          <Layer index={i} roads={roads} depth={depth} levels={at[h]} focus={focus} pointing={hovered !== null} active={h === horizon} onHover={onHover} onSelect={onSelect} />
        </group>
      ))}
      {focusRoad && <Column road={focusRoad} at={at} />}
      <Project groups={groups} labelAnchor={[SIZE / 2 + 0.45, 0, depth / 2 + 0.35]} labels={labels} tipAnchor={focusRoad ? [focusRoad.mid[0], LIFT, focusRoad.mid[2]] : null} tip={tip} />
      <FitCamera radius={Math.hypot(SIZE / 2 + 0.35, depth / 2 + 0.35, LIFT / 2 + 0.2)} />
      <OrbitControls makeDefault target={[0, LIFT / 2, 0]} enablePan={false} enableDamping={!still} minPolarAngle={0.2} maxPolarAngle={1.32} onChange={() => invalidate()} />
    </>
  );
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <StackUnavailable /> : this.props.children;
  }
}

function StackUnavailable() {
  return (
    <div className="stk__fallback">
      <p className="stk__fallback-title">The time stack could not start</p>
      <p>It needs WebGL. The map and the list show the same forecast.</p>
    </div>
  );
}

export default function ForecastStack(props: Props) {
  const still = !!useReducedMotion();
  const { roads, depth } = useRoads();
  const { at, hasForecast } = useLevels();
  const focus = props.hovered ?? props.selected;
  const focusRoad = focus ? roads.find((r) => r.id === focus) ?? null : null;
  const groups = useRef<(THREE.Group | null)[]>([]);
  const labels = useRef<(HTMLElement | null)[]>([]);
  const tip = useRef<HTMLDivElement | null>(null);

  return (
    <div
      className={`stk ${props.hovered ? 'is-pointing' : ''}`}
      role="group"
      aria-label="Forecast time stack: the road network now and 5, 10 and 15 minutes ahead, stacked upwards, each road coloured by its level. Drag to turn it. The same forecast is in the list."
    >
      <Boundary>
        <Canvas
          dpr={[1, 2]}
          frameloop="demand"
          flat
          camera={{ position: [5.6, 5.4, 7.2], fov: 32 }}
          gl={{ antialias: true }}
          fallback={<StackUnavailable />}
          onPointerMissed={() => props.onHover(null)}
        >
          <Scene {...props} still={still} roads={roads} depth={depth} at={at} focusRoad={focusRoad} groups={groups} labels={labels} tip={tip} />
        </Canvas>

        {/* DOM over the canvas, placed by <Project> */}
        <div className="stk__overlay" aria-hidden="true">
          {LAYERS.map((h, i) => (
            <span
              key={h}
              ref={(el) => {
                labels.current[i] = el;
              }}
              className={`stk__label ${h === props.horizon ? 'is-active' : ''}`}
            >
              {h === 0 ? 'Now' : `+${h} min`}
            </span>
          ))}
          {focusRoad && (
            <div className="stk__tip" ref={tip}>
              <p className="stk__tip-name">
                {focusRoad.name} <span className="mono">{focusRoad.id}</span>
              </p>
              <ol className="stk__tip-steps">
                {[...LAYERS].reverse().map((h) => {
                  const v = at[h][focusRoad.id];
                  const l = v?.level ?? 'no_data';
                  return (
                    <li key={h}>
                      <span className="stk__tip-h num">{h === 0 ? 'Now' : `+${h}`}</span>
                      <span className={`swatch swatch--${l}`} />
                      <span>{h > 0 && !hasForecast ? 'No forecast' : LEVEL_LABEL[l]}</span>
                      <span className="stk__tip-v num">{v?.kph != null ? `${fmtSpeed(v.kph)} km/h` : ''}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      </Boundary>
    </div>
  );
}
