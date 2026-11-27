import { Fragment, useMemo } from 'react';
import { ChevronRight, Cpu, Database, Radio, Server, Workflow, type LucideIcon } from 'lucide-react';
import { LineChart } from '../components/charts/charts';
import { Empty, Health, KeyValue, Notice, PageHead, Section, Stat, useNow } from '../components/ui/primitives';
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

/** Runs of neighbouring columns that run wholly on Condense are drawn inside one frame. */
function groups(cols: StageStatus[][]): { condense: boolean; cols: StageStatus[][] }[] {
  const out: { condense: boolean; cols: StageStatus[][] }[] = [];
  for (const col of cols) {
    const condense = col.every((s) => s.runs_on === 'condense');
    const last = out[out.length - 1];
    if (last && condense && last.condense) last.cols.push(col);
    else out.push({ condense, cols: [col] });
  }
  return out;
}

function Node({ s, now }: { s: StageStatus; now: number }) {
  const k = KIND[s.kind];
  const Icon = k.icon;
  return (
    <div className={`node node--${s.runs_on} node--${s.status}`}>
      <p className="node__kind">
        <Icon size={12} aria-hidden="true" />
        {k.label}
      </p>
      <p className="node__name mono">{s.name}</p>
      <p className="node__rates num">
        <span>{s.kind === 'producer' ? '–' : `${fmtOne(s.events_in_per_s)}/s`} in</span>
        <span>{s.kind === 'api' ? '–' : `${fmtOne(s.events_out_per_s)}/s`} out</span>
      </p>
      <div className="node__foot">
        <Health status={s.status} />
        <span className={`num ${s.errors_total ? 'warn' : ''}`}>{fmtInt(s.errors_total)} errors</span>
      </div>
      <p className="node__last">Last event {fmtAgo(s.last_event_at, now)}</p>
    </div>
  );
}

function Wire({ flowing }: { flowing: boolean }) {
  return (
    <div className={`wire ${flowing ? 'is-flowing' : ''}`} aria-hidden="true">
      <span className="wire__line" />
      <span className="wire__pulse" />
      <ChevronRight size={12} className="wire__head" />
    </div>
  );
}

export default function System() {
  const system = useLive((s) => s.system);
  const throughput = useLive((s) => s.throughput);
  const conn = useLive((s) => s.connection);
  const now = useNow(1000);
  const cols = useMemo(() => (system ? layers(system.stages) : []), [system]);
  const grouped = useMemo(() => groups(cols), [cols]);
  const condense = system?.stages.filter((s) => s.runs_on === 'condense') ?? [];

  const tp = useMemo(
    () => ({
      inPts: throughput.map((p) => ({ t: new Date(p.ts).getTime(), v: p.in_per_s })),
      outPts: throughput.map((p) => ({ t: new Date(p.ts).getTime(), v: p.out_per_s })),
      latPts: throughput.map((p) => ({ t: new Date(p.ts).getTime(), v: p.p95_ms })),
    }),
    [throughput],
  );

  const head = <PageHead title="System" lede="The Condense pipeline, Kafka, and this browser’s live stream" />;

  if (!system) {
    return (
      <div className="sys">
        {head}
        <div className="page">
          {conn.state === 'live' || conn.state === 'connecting' ? (
            <div className="skeleton" style={{ height: 200 }} />
          ) : (
            <Notice tone="bad" title="No status from the API">
              The app has no pipeline status yet. It shows here once the Arterial API answers or the stream connects.
            </Notice>
          )}
        </div>
      </div>
    );
  }

  let colIndex = 0;

  return (
    <div className="sys">
      {head}
      <div className="page sys__top">
        <div className="metrics sys__metrics enter" style={{ '--i': 40, '--n': 5 } as React.CSSProperties}>
          <div>
            <p className="stat__label">Kafka</p>
            <p className="stat__value stat__value--text">
              <Health status={system.kafka.connected ? 'ok' : 'down'} label={system.kafka.connected ? 'Connected' : 'Disconnected'} />
            </p>
            <p className="stat__note">
              {system.kafka.bootstrap_host ?? 'No broker'} · {fmtInt(system.kafka.reconnects)} reconnects
            </p>
          </div>
          <Stat label="Events in" value={system.throughput.in_per_s} format={fmtInt} unit="/s" note="Produced to telemetry-raw" />
          <Stat label="Events out" value={system.throughput.out_per_s} format={fmtInt} unit="/s" note="Passed validation" />
          <Stat
            label="Latency p95"
            value={system.latency_ms.p95}
            format={fmtInt}
            unit="ms"
            note={`p50 ${fmtInt(system.latency_ms.p50)} ms, event time to API`}
            tone={system.latency_ms.p95 > 5000 ? 'bad' : system.latency_ms.p95 > 2000 ? 'warn' : undefined}
          />
          <Stat label="Condense stages healthy" value={condense.filter((s) => s.status === 'ok').length} format={fmtInt} unit={`of ${condense.length}`} />
        </div>

        {!system.kafka.connected && system.kafka.last_error && (
          <Notice tone="bad" title="Kafka is disconnected">
            {system.kafka.last_error}
          </Notice>
        )}
      </div>

      <section className="sys__canvas enter" style={{ '--i': 90 } as React.CSSProperties} aria-labelledby="pipeline-title">
        <div className="sys__canvas-head">
          <div>
            <h2 className="sect__title" id="pipeline-title">
              Pipeline
            </h2>
            <p className="sect__meta">Stages as configured, from the simulator through Condense to this app. Pulses run only while events flow.</p>
          </div>
          <ul className="legend sys__legend">
            <li>
              <span className="legend__rect node-key--condense" /> Runs on Condense
            </li>
            <li>
              <span className="legend__rect node-key--kafka" /> Kafka topic
            </li>
            <li>
              <span className="legend__rect node-key--local" /> Runs outside Condense
            </li>
          </ul>
        </div>
        <div className="sys__scroll">
          <div className="flow">
            {grouped.map((g, gi) => {
              const prevCol = colIndex > 0 ? cols[colIndex - 1] : null;
              const body = g.cols.map((col, ci) => {
                const i = colIndex + ci;
                return (
                  <Fragment key={i}>
                    {ci > 0 && <Wire flowing={cols[i - 1].some((s) => s.events_out_per_s > 0)} />}
                    <div className="flow__col">
                      {col.map((s) => (
                        <Node key={s.id} s={s} now={now} />
                      ))}
                    </div>
                  </Fragment>
                );
              });
              colIndex += g.cols.length;
              return (
                <Fragment key={gi}>
                  {prevCol && <Wire flowing={prevCol.some((s) => s.events_out_per_s > 0)} />}
                  {g.condense ? (
                    <div className="flow__region">
                      <span className="flow__region-label">Condense</span>
                      {body}
                    </div>
                  ) : (
                    body
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      </section>

      <div className="page sys__lower">
        <div className="split split--even">
          <Section title="Throughput" meta="Events per second, last 15 minutes" enter={130}>
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
          </Section>
          <Section title="Processing latency" meta="p95 from event time to the API, in milliseconds" enter={150}>
            {tp.latPts.length > 1 ? (
              <LineChart
                title="p95 processing latency"
                unit="ms"
                yMin={0}
                height={220}
                formatTime={(t) => fmtTime(t).slice(0, 5)}
                series={[{ id: 'p95', label: 'p95', color: 'var(--series-1)', points: tp.latPts, area: true }]}
              />
            ) : (
              <Empty title="Collecting" />
            )}
          </Section>
        </div>

        <div className="split split--three">
          <Section title="Consumers" meta="Groups reading the output topics" enter={170}>
            {system.consumers.length ? (
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
                        <span className="muted small block">
                          {c.group} · commit {fmtAgo(c.last_commit_at, now)}
                        </span>
                      </td>
                      <td className="num-col num">{fmtInt(c.lag)}</td>
                      <td>
                        <Health status={c.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty title="No consumers reported" />
            )}
          </Section>
          <Section title="Errors" meta="Counted, never dropped silently" enter={190}>
            <KeyValue
              items={[
                { k: 'Rejected by validation', v: <span className="num">{fmtInt(system.errors.validation_rejected)}</span> },
                { k: 'Duplicates dropped', v: <span className="num">{fmtInt(system.errors.duplicates_dropped)}</span> },
                { k: 'Late events', v: <span className="num">{fmtInt(system.errors.late_events)}</span> },
                { k: 'Consumer errors', v: <span className={`num ${system.errors.consumer_errors ? 'bad' : ''}`}>{fmtInt(system.errors.consumer_errors)}</span> },
              ]}
            />
            <p className="sys__fine">Rejected events go to telemetry-rejected. Duplicates are the same event id within 10 minutes; late events miss the 10 s allowance.</p>
          </Section>
          <Section title="This browser" meta="The live stream from the API" enter={210}>
            <KeyValue
              items={[
                {
                  k: 'Stream',
                  v: <Health status={conn.state === 'live' ? 'ok' : conn.state === 'offline' ? 'down' : 'degraded'} label={conn.state[0].toUpperCase() + conn.state.slice(1)} />,
                },
                { k: 'Connected for', v: <span className="num">{conn.since ? fmtDuration((now - conn.since) / 1000) : '–'}</span> },
                { k: 'Last event', v: <span className="num">{fmtAgo(conn.lastEventAt, now)}</span> },
                { k: 'Last event id', v: <span className="mono">{conn.lastEventId ?? '–'}</span> },
                { k: 'Events received', v: <span className="num">{fmtInt(conn.eventsReceived)}</span> },
                { k: 'Drops and retries', v: <span className="num">{fmtInt(conn.reconnects)}</span> },
              ]}
            />
            {conn.error && <p className="sys__fine">{conn.error}</p>}
          </Section>
        </div>

        <div className="split split--even">
          <Section title="Last processed event" enter={230}>
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
          </Section>
          <Section title="Simulator" meta="Synthetic telemetry only. It drives no real vehicle or signal." enter={250}>
            <KeyValue
              items={[
                { k: 'State', v: <Health status={system.simulation.running ? 'ok' : 'unknown'} label={system.simulation.running ? 'Running' : 'Stopped'} /> },
                { k: 'Scenario', v: system.simulation.scenario },
                { k: 'Seed', v: <span className="mono">{system.simulation.seed}</span> },
                { k: 'Vehicles', v: <span className="num">{fmtInt(system.simulation.vehicles)}</span> },
                { k: 'Target rate', v: <span className="num">{fmtInt(system.simulation.target_rate)} events/s</span> },
              ]}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
