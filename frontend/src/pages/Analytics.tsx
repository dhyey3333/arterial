import { useMemo, useState } from 'react';
import { Columns, HeatGrid, LineChart } from '../components/charts/charts';
import { Empty, Notice, Panel, Segmented, Stat } from '../components/ui/primitives';
import { useAnalytics } from '../data/queries';
import { useLive } from '../data/store';
import { fmtCompact, fmtDateTime, fmtHour, fmtInt, fmtOne, fmtPct, fmtShortTime, fmtSpeed } from '../lib/format';

export default function Analytics() {
  const [days, setDays] = useState(7);
  const q = useAnalytics(days);
  const segIndex = useLive((s) => s.segIndex);
  const a = q.data;

  const ranked = useMemo(() => [...(a?.segments ?? [])].sort((x, y) => y.congested_minutes - x.congested_minutes), [a]);
  const heatRows = useMemo(() => ranked.slice(0, 12).map((s) => s.segment_id), [ranked]);
  const heatIndex = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of a?.heat ?? []) m.set(`${h.segment_id}|${h.hour}`, h.congested_share);
    return m;
  }, [a]);
  const maxMinutes = ranked[0]?.congested_minutes ?? 1;
  const peakSet = useMemo(() => new Set(a?.peak_hours ?? []), [a]);
  const worstHour = a?.hourly.reduce((m, h) => (h.congested_share > m.congested_share ? h : m), a.hourly[0]);
  const bestHour = a?.hourly.reduce((m, h) => ((h.avg_speed_kph ?? 0) > (m.avg_speed_kph ?? 0) ? h : m), a.hourly[0]);

  return (
    <div className={`stack ${q.isFetching && a ? 'is-refetching' : ''}`}>
      <div className="filters enter" style={{ '--i': 0 } as React.CSSProperties}>
        <Segmented<number>
          label="Period"
          value={days}
          onChange={setDays}
          options={[
            { value: 1, label: 'Last day' },
            { value: 7, label: 'Last 7 days' },
          ]}
        />
        <p className="filters__note muted">
          {a ? `${fmtInt(a.simulated_days)} simulated ${a.simulated_days === 1 ? 'day' : 'days'} · ${fmtDateTime(a.from)} to ${fmtDateTime(a.to)} IST` : 'Loading stored history'}
        </p>
      </div>

      {q.isError && !a ? (
        <Notice tone="bad" title="Analytics unavailable">
          {(q.error as Error).message}
        </Notice>
      ) : null}

      <div className="grid grid--stats enter" style={{ '--i': 40 } as React.CSSProperties}>
        <Panel>
          <Stat label="Worst hour" value={worstHour?.hour ?? null} format={(v) => (v === null ? '–' : fmtHour(Math.round(v)))} note={worstHour ? `${fmtPct(worstHour.congested_share, { fromRatio: true })} of road congested` : undefined} />
        </Panel>
        <Panel>
          <Stat label="Best hour" value={bestHour?.hour ?? null} format={(v) => (v === null ? '–' : fmtHour(Math.round(v)))} note={bestHour ? `${fmtSpeed(bestHour.avg_speed_kph)} km/h average` : undefined} />
        </Panel>
        <Panel>
          <Stat label="Most congested segment" value={ranked[0] ? ranked[0].congested_minutes / 60 : null} format={fmtOne} unit="h" note={ranked[0] ? `${segIndex[ranked[0].segment_id]?.name ?? ranked[0].segment_id} (${ranked[0].segment_id})` : undefined} />
        </Panel>
        <Panel>
          <Stat label="Incidents detected" value={a ? a.segments.reduce((s, x) => s + x.incidents, 0) : null} format={fmtInt} note="Simulated anomalies over the period" />
        </Panel>
      </div>

      <div className="grid grid--2">
        <Panel title="Average speed by hour of day" meta="Peak hours, from the share of road congested, are highlighted" enter={70}>
          {a ? (
            <Columns
              title="Average network speed by hour"
              unit="km/h"
              data={a.hourly.map((h) => ({ key: h.hour, value: h.avg_speed_kph }))}
              formatValue={(v) => fmtSpeed(v)}
              formatLabel={fmtHour}
              highlight={peakSet}
              highlightLabel="Peak hour"
            />
          ) : (
            <div className="skeleton" style={{ height: 220 }} />
          )}
        </Panel>
        <Panel title="Traffic flow" meta="Network flow, vehicles per hour, every 30 minutes" enter={100}>
          {a ? (
            <LineChart
              title="Network flow over time"
              unit="veh/h"
              yMin={0}
              formatValue={(v) => fmtCompact(v)}
              formatTime={(t) => fmtShortTime(t)}
              series={[{ id: 'flow', label: 'Flow', color: 'var(--series-1)', points: a.flow.map((f) => ({ t: new Date(f.ts).getTime(), v: f.flow_veh_per_h })) }]}
            />
          ) : (
            <div className="skeleton" style={{ height: 220 }} />
          )}
        </Panel>
      </div>

      <Panel title="When each corridor congests" meta="Share of each hour spent heavy or severe, for the 12 most congested segments" enter={130}>
        {a && heatRows.length ? (
          <HeatGrid
            title="Congestion share by segment and hour"
            rows={heatRows}
            cols={Array.from({ length: 24 }, (_, h) => h)}
            value={(r, c) => heatIndex.get(`${r}|${c}`) ?? null}
            rowLabel={(r) => (
              <>
                {segIndex[r]?.name ?? r} <span className="mono muted">{r}</span>
              </>
            )}
            colLabel={fmtHour}
            formatValue={(v) => fmtPct(v, { fromRatio: true })}
          />
        ) : a ? (
          <Empty title="No congestion recorded yet" />
        ) : (
          <div className="skeleton" style={{ height: 320 }} />
        )}
      </Panel>

      <Panel title="Road performance" meta="Reliability is the bad-day (15th-percentile) speed as a share of free-flow speed: 100% means a bad day runs as fast as an empty road" enter={160} bodyClassName="panel__body--flush">
        {ranked.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Segment</th>
                  <th scope="col">Time congested</th>
                  <th scope="col" className="num-col">Episodes</th>
                  <th scope="col" className="num-col">Avg speed</th>
                  <th scope="col" className="num-col">Bad-day speed</th>
                  <th scope="col" className="num-col">Reliability</th>
                  <th scope="col" className="num-col">Incidents</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((s) => (
                  <tr key={s.segment_id}>
                    <th scope="row">
                      <span className="rowlink__name">{segIndex[s.segment_id]?.name ?? s.segment_id}</span> <span className="mono muted">{s.segment_id}</span>
                    </th>
                    <td>
                      <span className="hbar">
                        <span className="hbar__fill" style={{ transform: `scaleX(${s.congested_minutes / maxMinutes})` }} />
                        <span className="num hbar__value">{fmtOne(s.congested_minutes / 60)} h</span>
                      </span>
                    </td>
                    <td className="num-col num">{fmtInt(s.congestion_episodes)}</td>
                    <td className="num-col num">{fmtSpeed(s.avg_speed_kph)} km/h</td>
                    <td className="num-col num">{fmtSpeed(s.p15_speed_kph)} km/h</td>
                    <td className="num-col num">{s.reliability === null ? '–' : fmtPct(s.reliability, { fromRatio: true })}</td>
                    <td className="num-col num">{fmtInt(s.incidents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : a ? (
          <Empty title="No stored history yet">Analytics fill once the pipeline has written segment windows.</Empty>
        ) : (
          <div className="skeleton" style={{ height: 300, margin: 16 }} />
        )}
      </Panel>
    </div>
  );
}
