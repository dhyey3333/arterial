import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { Columns, HeatGrid, LineChart } from '../components/charts/charts';
import { Empty, Notice, PageHead, Section, Segmented, Stat } from '../components/ui/primitives';
import { useAnalytics } from '../data/queries';
import { useLive } from '../data/store';
import { fmtCompact, fmtDateTime, fmtHour, fmtInt, fmtOne, fmtPct, fmtShortTime, fmtSpeed } from '../lib/format';

// three.js loads only when someone asks for the landscape
const HeatLandscape = lazy(() => import('../components/stack/HeatLandscape'));

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
  const heatValue = useCallback((r: string, c: number) => heatIndex.get(`${r}|${c}`) ?? null, [heatIndex]);
  const [heatView, setHeatView] = useState<'grid' | 'landscape'>('grid');
  const maxMinutes = ranked[0]?.congested_minutes ?? 1;
  const peakSet = useMemo(() => new Set(a?.peak_hours ?? []), [a]);
  const worstHour = a?.hourly.reduce((m, h) => (h.congested_share > m.congested_share ? h : m), a.hourly[0]);
  const bestHour = a?.hourly.reduce((m, h) => ((h.avg_speed_kph ?? 0) > (m.avg_speed_kph ?? 0) ? h : m), a.hourly[0]);
  const top = ranked[0];
  const topName = top ? segIndex[top.segment_id]?.name ?? top.segment_id : null;
  const incidentsTotal = a ? a.segments.reduce((s, x) => s + x.incidents, 0) : null;

  return (
    <div className={`report ${q.isFetching && a ? 'is-refetching' : ''}`}>
      <PageHead title="Analytics" lede="Peaks, problem corridors and reliability across the stored simulated history">
        <Segmented<number>
          label="Period"
          value={days}
          onChange={setDays}
          options={[
            { value: 1, label: 'Last day' },
            { value: 7, label: 'Last 7 days' },
          ]}
        />
      </PageHead>

      <div className="page report__body">
        {q.isError && !a ? (
          <Notice tone="bad" title="Analytics unavailable">
            {(q.error as Error).message}
          </Notice>
        ) : null}

        {a && worstHour && top ? (
          <p className="report__lead enter" style={{ '--i': 40 } as React.CSSProperties}>
            Across <strong>{a.simulated_days === 1 ? 'one simulated day' : `${fmtInt(a.simulated_days)} simulated days`}</strong>, the network was most congested at{' '}
            <strong className="num">{fmtHour(worstHour.hour)}</strong>, when <strong className="num">{fmtPct(worstHour.congested_share, { fromRatio: true })}</strong> of
            road ran heavy or severe. <strong>{topName}</strong> <span className="mono muted">{top.segment_id}</span> spent{' '}
            <strong className="num">{fmtOne(top.congested_minutes / 60)} hours</strong> congested, more than any other segment.
          </p>
        ) : !q.isError ? (
          <div className="skeleton report__lead-skeleton" />
        ) : null}
        {a && <p className="report__period num">{`${fmtDateTime(a.from)} to ${fmtDateTime(a.to)} IST`}</p>}

        <div className="metrics report__metrics enter" style={{ '--i': 80, '--n': 4 } as React.CSSProperties}>
          <Stat label="Worst hour" value={worstHour?.hour ?? null} format={(v) => (v === null ? '–' : fmtHour(Math.round(v)))} note={worstHour ? `${fmtPct(worstHour.congested_share, { fromRatio: true })} of road congested` : undefined} />
          <Stat label="Best hour" value={bestHour?.hour ?? null} format={(v) => (v === null ? '–' : fmtHour(Math.round(v)))} note={bestHour ? `${fmtSpeed(bestHour.avg_speed_kph)} km/h average` : undefined} />
          <Stat label="Most congested segment" value={top ? top.congested_minutes / 60 : null} format={fmtOne} unit="h" note={top ? `${topName} (${top.segment_id})` : undefined} />
          <Stat label="Incidents detected" value={incidentsTotal} format={fmtInt} note="Simulated anomalies over the period" />
        </div>

        <div className="split split--even">
          <Section title="Average speed by hour of day" meta="Peak hours, from the share of road congested, in white" enter={120}>
            {a ? (
              <Columns
                title="Average network speed by hour"
                unit="km/h"
                height={240}
                data={a.hourly.map((h) => ({ key: h.hour, value: h.avg_speed_kph }))}
                formatValue={(v) => fmtSpeed(v)}
                formatLabel={fmtHour}
                highlight={peakSet}
                highlightLabel="Peak hour"
                color="var(--accent)"
              />
            ) : (
              <div className="skeleton" style={{ height: 240 }} />
            )}
          </Section>
          <Section title="Traffic flow" meta="Vehicles per hour across the network, every 30 minutes" enter={150}>
            {a ? (
              <LineChart
                title="Network flow over time"
                unit="veh/h"
                yMin={0}
                height={240}
                formatValue={(v) => fmtCompact(v)}
                formatTime={(t) => fmtShortTime(t)}
                series={[{ id: 'flow', label: 'Flow', color: 'var(--series-1)', points: a.flow.map((f) => ({ t: new Date(f.ts).getTime(), v: f.flow_veh_per_h })), area: true }]}
              />
            ) : (
              <div className="skeleton" style={{ height: 240 }} />
            )}
          </Section>
        </div>

        <Section
          title="When each corridor congests"
          meta={heatView === 'grid' ? 'Share of each hour spent heavy or severe, for the 12 most congested segments' : 'Hours left to right, the most congested segment at the back · drag to turn'}
          actions={
            a && heatRows.length ? (
              <Segmented<'grid' | 'landscape'>
                label="Heat view"
                value={heatView}
                onChange={setHeatView}
                options={[
                  { value: 'grid', label: 'Grid' },
                  { value: 'landscape', label: 'Landscape' },
                ]}
              />
            ) : undefined
          }
          enter={180}
        >
          {a && heatRows.length && heatView === 'landscape' ? (
            <div className="hl-wrap">
              <Suspense fallback={<div className="skeleton hl-wrap__loading" />}>
                <HeatLandscape rows={heatRows} name={(id) => segIndex[id]?.name ?? id} value={heatValue} formatHour={fmtHour} formatValue={(v) => fmtPct(v, { fromRatio: true })} />
              </Suspense>
            </div>
          ) : a && heatRows.length ? (
            <HeatGrid
              title="Congestion share by segment and hour"
              rows={heatRows}
              cols={Array.from({ length: 24 }, (_, h) => h)}
              value={heatValue}
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
        </Section>

        <Section
          title="Road performance"
          meta="Reliability is the bad-day (15th-percentile) speed as a share of free-flow speed: 100% means a bad day runs as fast as an empty road."
          enter={200}
        >
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
                          <span className="hbar__track">
                            <span className="hbar__fill" style={{ transform: `scaleX(${s.congested_minutes / maxMinutes})` }} />
                          </span>
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
            <div className="skeleton" style={{ height: 300 }} />
          )}
        </Section>
      </div>
    </div>
  );
}
