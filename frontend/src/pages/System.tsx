import { Fragment, useMemo } from 'react';
import { Database, Radio, Server, Workflow, Cpu, ChevronRight, type LucideIcon } from 'lucide-react';
import { LineChart } from '../components/charts/charts';
import { Empty, Health, KeyValue, Notice, Panel, Stat, useNow } from '../components/ui/primitives';
import { useLive } from '../data/store';
import type { StageStatus } from '../lib/contract';
import { fmtAgo, fmtDuration, fmtInt, fmtOne, fmtTime } from '../lib/format';

const KIND: Record<StageStatus['kind'], { label: string; icon: LucideIcon }> = {
  producer: { label: 'Producer', icon: Cpu },
  topic: { label: 'Kafka topic', icon: Database },
  connector: { label: 'Connector', icon: Radio },
  transform: { label: 'Condense transform', icon: Workflow },
  utility: { label: 'Condense utility', icon: Workflow },
  consumer: { label: 'Consumer', icon: Server },
  api: { label: 'App API', icon: Server },
};

/** Columns by longest path from a source, so fan-out stages stack in one column. */
function layers(stages: StageStatus[]): StageStatus[][] {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const depth = new Map<string, number>();
  const upstream = new Map<string, string[]>();
  for (const s of stages) for (const d of s.downstream) upstream.set(d, [...(upstream.get(d) ?? []), s.id]);
  const visit = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0; // a cycle: draw it flat rather than loop
    seen.add(id);
    const ups = (upstream.get(id) ?? []).filter((u) => byId.has(u));
    const d = ups.length ? Math.max(...ups.map((u) => visit(u, seen))) + 1 : 0;
    depth.set(id, d);
    return d;
  };
  stages.forEach((s) => visit(s.id));
  const cols: StageStatus[][] = [];
  for (const s of stages) (cols[depth.get(s.id)!] ??= []).push(s);
  return cols.filter(Boolean);
}

function StageCard({ s, now }: { s: StageStatus; now: number }) {
  const k = KIND[s.kind];
  const Icon = k.icon;
  return (
    <div className={`stage stage--${s.runs_on} stage--${s.status}`}>
      <p className="stage__kind">
        <Icon size={13} aria-hidden="true" />
        {k.label}
      </p>
      <p className="stage__name mono">{s.name}</p>
      <Health status={s.status} />
      <dl className="stage__nums">
        <div>
          <dt>In</dt>
          <dd className="num">{s.kind === 'producer' ? '–' : `${fmtOne(s.events_in_per_s)}/s`}</dd>
        </div>
        <div>
          <dt>Out</dt>
          <dd className="num">{s.kind === 'api' ? '–' : `${fmtOne(s.events_out_per_s)}/s`}</dd>
        </div>
        <div>
          <dt>Errors</dt>
          <dd className={`num ${s.errors_total ? 'warn' : ''}`}>{fmtInt(s.errors_total)}</dd>
        </div>
      </dl>
      <p className="stage__last muted">Last event {fmtAgo(s.last_event_at, now)}</p>
    </div>
  );
}

function Link({ flowing }: { flowing: boolean }) {
  return (
    <div className={`flowlink ${flowing ? 'is-flowing' : ''}`} aria-hidden="true">
      <span className="flowlink__line" />
      <span className="flowlink__pulse" />
      <ChevronRight size={14} className="flowlink__head" />
    </div>
  );
}

export default function System() {
  const system = useLive((s) => s.system);
  const throughput = useLive((s) => s.throughput);
  const conn = useLive((s) => s.connection);
  const now = useNow(1000);
  const cols = useMemo(() => (system ? layers(system.stages) : []), [system]);
  const condense = system?.stages.filter((s) => s.runs_on === 'condense') ?? [];

  const tp = useMemo(
    () => ({
      inPts: throughput.map((p) => ({ t: new Date(p.ts).getTime(), v: p.in_per_s })),
      outPts: throughput.map((p) => ({ t: new Date(p.ts).getTime(), v: p.out_per_s })),
      latPts: throughput.map((p) => ({ t: new Date(p.ts).getTime(), v: p.p95_ms })),
    }),
    [throughput],
  );

  if (!system) {
    return (
      <div className="stack">
        <Panel enter={0}>
          {conn.state === 'live' || conn.state === 'connecting' ? (
            <div className="skeleton" style={{ height: 200 }} />
          ) : (
            <Notice tone="bad" title="No status from the API">
              The app has no pipeline status yet. It shows here once the Arterial API answers or the stream connects.
            </Notice>
          )}
        </Panel>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="grid grid--stats5 enter" style={{ '--i': 0 } as React.CSSProperties}>
        <Panel>
          <div className="stat">
            <p className="stat__label">Kafka</p>
            <p className="stat__value stat__value--text">
              <Health status={system.kafka.connected ? 'ok' : 'down'} label={system.kafka.connected ? 'Connected' : 'Disconnected'} />
            </p>
            <p className="stat__note">
              {system.kafka.bootstrap_host ?? 'No broker'} · {fmtInt(system.kafka.reconnects)} reconnects
            </p>
          </div>
        </Panel>
        <Panel>
          <Stat label="Events in" value={system.throughput.in_per_s} format={fmtInt} unit="/s" note="Produced to telemetry-raw" />
        </Panel>
        <Panel>
          <Stat label="Events out" value={system.throughput.out_per_s} format={fmtInt} unit="/s" note="Passed validation" />
        </Panel>
        <Panel>
          <Stat label="Latency p95" value={system.latency_ms.p95} format={fmtInt} unit="ms" note={`p50 ${fmtInt(system.latency_ms.p50)} ms, event time to API`} tone={system.latency_ms.p95 > 5000 ? 'bad' : system.latency_ms.p95 > 2000 ? 'warn' : undefined} />
        </Panel>
        <Panel>
          <Stat label="Condense stages healthy" value={condense.filter((s) => s.status === 'ok').length} format={fmtInt} unit={`of ${condense.length}`} />
        </Panel>
      </div>

      {!system.kafka.connected && system.kafka.last_error && (
        <Notice tone="bad" title="Kafka is disconnected">
          {system.kafka.last_error}
        </Notice>
      )}

      <Panel title="Pipeline" meta="Stages as configured, from the simulator through Condense to this app. Pulses run only while events flow." enter={40} bodyClassName="panel__body--scroll">
        <div className="flow">
          {cols.map((col, i) => (
            <Fragment key={i}>
              {i > 0 && <Link flowing={cols[i - 1].some((s) => s.events_out_per_s > 0)} />}
              <div className="flow__col">
                {col.map((s) => (
                  <StageCard key={s.id} s={s} now={now} />
                ))}
              </div>
            </Fragment>
          ))}
        </div>
        <ul className="legend flow__legend">
          <li>
            <span className="legend__rect stage-key--condense" /> Runs on Condense
          </li>
          <li>
            <span className="legend__rect stage-key--kafka" /> Kafka topic
          </li>
          <li>
            <span className="legend__rect stage-key--local" /> Runs outside Condense
          </li>
        </ul>
      </Panel>

      <div className="grid grid--2">
        <Panel title="Throughput" meta="Events per second, last 15 minutes" enter={70}>
          {tp.inPts.length > 1 ? (
            <LineChart
              title="Pipeline throughput"
              unit="events/s"
              yMin={0}
              height={220}
              formatTime={(t) => fmtTime(t).slice(0, 5)}
              series={[
                { id: 'in', label: 'In', color: 'var(--series-1)', points: tp.inPts },
                { id: 'out', label: 'Out (valid)', color: 'var(--series-2)', points: tp.outPts },
              ]}
            />
          ) : (
            <Empty title="Collecting">Throughput history builds from status updates every 2 seconds.</Empty>
          )}
        </Panel>
        <Panel title="Processing latency" meta="p95, event time to the API, milliseconds" enter={90}>
          {tp.latPts.length > 1 ? (
            <LineChart title="p95 processing latency" unit="ms" yMin={0} height={220} formatTime={(t) => fmtTime(t).slice(0, 5)} series={[{ id: 'p95', label: 'p95', color: 'var(--series-1)', points: tp.latPts }]} />
          ) : (
            <Empty title="Collecting" />
          )}
        </Panel>
      </div>

      <div className="grid grid--3">
        <Panel title="Consumers" meta="Consumer groups reading the output topics" enter={110} bodyClassName="panel__body--flush">
          {system.consumers.length ? (
            <div className="table-wrap">
              <table className="table table--compact">
                <thead>
                  <tr>
                    <th scope="col">Topic</th>
                    <th scope="col" className="num-col">Lag</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {system.consumers.map((c) => (
                    <tr key={`${c.group}-${c.topic}`}>
                      <td>
                        <span className="mono">{c.topic}</span>
                        <span className="muted small block">{c.group} · commit {fmtAgo(c.last_commit_at, now)}</span>
                      </td>
                      <td className="num-col num">{fmtInt(c.lag)}</td>
                      <td>
                        <Health status={c.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No consumers reported" />
          )}
        </Panel>
        <Panel title="Errors" meta="Counted, never dropped silently" enter={130}>
          <div className="errgrid">
            <Stat label="Rejected by validation" value={system.errors.validation_rejected} format={fmtInt} note="Sent to telemetry-rejected" />
            <Stat label="Duplicates dropped" value={system.errors.duplicates_dropped} format={fmtInt} note="Same event id within 10 min" />
            <Stat label="Late events" value={system.errors.late_events} format={fmtInt} note="Past the 10 s lateness allowance" />
            <Stat label="Consumer errors" value={system.errors.consumer_errors} format={fmtInt} tone={system.errors.consumer_errors ? 'bad' : undefined} />
          </div>
        </Panel>
        <Panel title="This browser" meta="The live stream from the API" enter={150}>
          <KeyValue
            items={[
              { k: 'Stream', v: <Health status={conn.state === 'live' ? 'ok' : conn.state === 'offline' ? 'down' : 'degraded'} label={conn.state[0].toUpperCase() + conn.state.slice(1)} /> },
              { k: 'Connected for', v: <span className="num">{conn.since ? fmtDuration((now - conn.since) / 1000) : '–'}</span> },
              { k: 'Last event', v: <span className="num">{fmtAgo(conn.lastEventAt, now)}</span> },
              { k: 'Last event id', v: <span className="mono">{conn.lastEventId ?? '–'}</span> },
              { k: 'Events received', v: <span className="num">{fmtInt(conn.eventsReceived)}</span> },
              { k: 'Drops and retries', v: <span className="num">{fmtInt(conn.reconnects)}</span> },
            ]}
          />
          {conn.error && <p className="muted small">{conn.error}</p>}
        </Panel>
      </div>

      <div className="grid grid--2">
        <Panel title="Last processed event" enter={170}>
          {system.last_event ? (
            <KeyValue
              items={[
                { k: 'Event id', v: <span className="mono">{system.last_event.event_id}</span> },
                { k: 'Vehicle', v: <span className="mono">{system.last_event.vehicle_id}</span> },
                { k: 'Segment', v: <span className="mono">{system.last_event.segment_id}</span> },
                { k: 'Event time', v: <span className="num">{fmtTime(system.last_event.ts)} IST</span> },
                { k: 'Processed', v: <span className="num">{fmtTime(system.last_event.processed_at)} IST</span> },
              ]}
            />
          ) : (
            <Empty title="No event processed yet" />
          )}
        </Panel>
        <Panel title="Simulator" meta="Synthetic telemetry only. It drives no real vehicle or signal." enter={190}>
          <KeyValue
            items={[
              { k: 'State', v: <Health status={system.simulation.running ? 'ok' : 'unknown'} label={system.simulation.running ? 'Running' : 'Stopped'} /> },
              { k: 'Scenario', v: system.simulation.scenario },
              { k: 'Seed', v: <span className="mono">{system.simulation.seed}</span> },
              { k: 'Vehicles', v: <span className="num">{fmtInt(system.simulation.vehicles)}</span> },
              { k: 'Target rate', v: <span className="num">{fmtInt(system.simulation.target_rate)} events/s</span> },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
