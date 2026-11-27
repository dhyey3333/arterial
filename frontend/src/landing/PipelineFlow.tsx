import { useLive } from '../data/store';
import { fmtOne } from '../lib/format';

interface Node {
  id: string;
  kind: string;
  name: string;
  x: number;
  y: number;
  condense?: boolean;
}

const W = 150;
const H = 66;
const NODES: Node[] = [
  { id: 'simulator', kind: 'Producer', name: 'Telemetry simulator', x: 10, y: 157 },
  { id: 'telemetry-raw', kind: 'Kafka topic', name: 'telemetry-raw', x: 190, y: 157 },
  { id: 'validate', kind: 'Condense transform', name: 'validate-telemetry', x: 382, y: 157, condense: true },
  { id: 'window', kind: 'Condense transform', name: 'segment-window', x: 572, y: 157, condense: true },
  { id: 'split', kind: 'Condense utility', name: 'Split: level changes', x: 772, y: 57, condense: true },
  { id: 'incidents', kind: 'Condense transform', name: 'incident-detector', x: 772, y: 157, condense: true },
  { id: 'forecast', kind: 'Condense transform', name: 'congestion-forecast', x: 772, y: 257, condense: true },
  { id: 'api', kind: 'App API', name: 'Arterial API', x: 1010, y: 157 },
];
const byId = new Map(NODES.map((n) => [n.id, n]));
const EDGES: [string, string][] = [
  ['simulator', 'telemetry-raw'],
  ['telemetry-raw', 'validate'],
  ['validate', 'window'],
  ['window', 'split'],
  ['window', 'incidents'],
  ['window', 'forecast'],
  ['split', 'api'],
  ['incidents', 'api'],
  ['forecast', 'api'],
];

function edgePath(a: Node, b: Node): string {
  const x0 = a.x + W;
  const y0 = a.y + H / 2;
  const x1 = b.x;
  const y1 = b.y + H / 2;
  if (y0 === y1) return `M${x0} ${y0}H${x1}`;
  const mx = (x0 + x1) / 2;
  return `M${x0} ${y0}C${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`;
}

/**
 * The pipeline as the console's System page draws it, with light travelling the edges in order:
 * simulator to topic, through the Condense transforms, out to the API. Rates come from the stream's
 * status when it has one; the drawing never invents them.
 */
export function PipelineFlow() {
  const system = useLive((s) => s.system);
  const rate = (id: string) => {
    const st = system?.stages.find((s) => s.id === id);
    return st ? `${fmtOne(st.events_out_per_s || st.events_in_per_s)}/s` : null;
  };
  return (
    <div className="lp-flow">
      <svg className="lp-flow__svg" viewBox="0 0 1170 380" role="img" aria-label="Arterial's pipeline: the telemetry simulator writes to the telemetry-raw Kafka topic; on Condense, validate-telemetry checks each event and segment-window closes a 30-second window per segment; then the Split utility, incident-detector and congestion-forecast run side by side and feed the Arterial API.">
        <rect className="lp-flow__region" x={366} y={28} width={572} height={330} rx={18} />
        <text className="lp-flow__region-label" x={386} y={54}>
          Condense
        </text>
        {EDGES.map(([a, b], i) => {
          const d = edgePath(byId.get(a)!, byId.get(b)!);
          return (
            <g key={`${a}-${b}`}>
              <path className="lp-flow__edge" d={d} />
              <circle className="lp-comet" r={3.2}>
                <animateMotion dur="1.4s" repeatCount="indefinite" path={d} begin={`${(i < 3 ? i : i < 6 ? 3 : 4) * 0.35}s`} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.77 0 0.175 1" />
              </circle>
            </g>
          );
        })}
        {NODES.map((n) => (
          <g key={n.id} className={`lp-flow__node ${n.condense ? 'is-condense' : ''} ${n.id === 'telemetry-raw' ? 'is-topic' : ''}`} transform={`translate(${n.x} ${n.y})`}>
            <rect width={W} height={H} rx={11} />
            <text className="lp-flow__kind" x={13} y={22}>
              {n.kind}
            </text>
            <text className="lp-flow__name" x={13} y={43}>
              {n.name}
            </text>
            {rate(n.id) && (
              <text className="lp-flow__rate" x={13} y={58}>
                {rate(n.id)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <ol className="lp-flow__list">
        {NODES.map((n) => (
          <li key={n.id} className={n.condense ? 'is-condense' : ''}>
            <span className="lp-flow__list-kind">{n.kind}</span>
            <span className="lp-flow__list-name">{n.name}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
