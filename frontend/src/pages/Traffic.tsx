import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { LevelBar, LineChart, Sparkline, type Point } from '../components/charts/charts';
import { SegmentDetail, TrendMark } from '../components/SegmentDetail';
import { Drawer } from '../components/ui/Drawer';
import { Empty, LevelBadge, Panel, Segmented, Stat } from '../components/ui/primitives';
import { useTrafficHistory } from '../data/queries';
import { useLive } from '../data/store';
import type { SegmentLevel, SegmentState, RoadSegment } from '../lib/contract';
import { LEVEL_RANK, fmtInt, fmtOne, fmtPct, fmtShortTime, fmtSpeed } from '../lib/format';

type SortKey = 'name' | 'level' | 'speed' | 'reduction' | 'density' | 'flow' | 'trend';
type LevelFilter = 'all' | SegmentLevel;

interface Row {
  seg: RoadSegment;
  st: SegmentState | undefined;
}

const sorters: Record<SortKey, (a: Row, b: Row) => number> = {
  name: (a, b) => a.seg.name.localeCompare(b.seg.name) || a.seg.id.localeCompare(b.seg.id),
  level: (a, b) => LEVEL_RANK[a.st?.level ?? 'no_data'] - LEVEL_RANK[b.st?.level ?? 'no_data'] || (a.st?.severity ?? 0) - (b.st?.severity ?? 0),
  speed: (a, b) => (a.st?.avg_speed_kph ?? -1) - (b.st?.avg_speed_kph ?? -1),
  reduction: (a, b) => (a.st?.speed_reduction_pct ?? -1) - (b.st?.speed_reduction_pct ?? -1),
  density: (a, b) => (a.st?.density_veh_per_km ?? -1) - (b.st?.density_veh_per_km ?? -1),
  flow: (a, b) => (a.st?.flow_veh_per_h ?? -1) - (b.st?.flow_veh_per_h ?? -1),
  trend: (a, b) => (a.st?.trend_kph_per_min ?? 0) - (b.st?.trend_kph_per_min ?? 0),
};

function SortHeader({ k, label, sort, onSort, numeric }: { k: SortKey; label: string; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void; numeric?: boolean }) {
  const active = sort.key === k;
  return (
    <th scope="col" className={numeric ? 'num-col' : undefined} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`th-sort ${active ? 'is-active' : ''}`} onClick={() => onSort(k)}>
        {label}
        {active ? sort.dir === 1 ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" /> : null}
      </button>
    </th>
  );
}

function SpeedBullet({ v, ff, level }: { v: number | null; ff: number; level: SegmentLevel }) {
  const share = v === null ? 0 : Math.min(1, v / (ff * 1.1));
  return (
    <span className="bullet" aria-hidden="true">
      <span className={`bullet__fill bullet__fill--${level}`} style={{ transform: `scaleX(${share})` }} />
      <span className="bullet__ff" style={{ left: `${(1 / 1.1) * 100}%` }} />
    </span>
  );
}

export default function Traffic() {
  const network = useLive((s) => s.network);
  const states = useLive((s) => s.states);
  const history = useLive((s) => s.speedHistory);
  const summary = useLive((s) => s.summary);
  const summaryHistory = useLive((s) => s.summaryHistory);
  const windowEnd = useLive((s) => s.windowEnd);
  const hist = useTrafficHistory(60);

  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<LevelFilter>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'level', dir: -1 });
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo<Row[]>(() => {
    if (!network) return [];
    const q = query.trim().toLowerCase();
    return network.segments
      .map((seg) => ({ seg, st: states[seg.id] }))
      .filter((r) => (level === 'all' ? true : (r.st?.level ?? 'no_data') === level))
      .filter((r) => !q || r.seg.name.toLowerCase().includes(q) || r.seg.id.toLowerCase().includes(q))
      .sort((a, b) => sorters[sort.key](a, b) * sort.dir);
  }, [network, states, query, level, sort]);

  const km = useMemo(() => {
    const out: Record<SegmentLevel, number> = { free: 0, moderate: 0, heavy: 0, severe: 0, no_data: 0 };
    for (const s of network?.segments ?? []) out[states[s.id]?.level ?? 'no_data'] += s.length_m / 1000;
    return out;
  }, [network, states]);

  const worsening = Object.values(states).filter((s) => s.trend === 'worsening').length;

  const speedSeries = useMemo(() => {
    const now = new Map<number, number | null>();
    for (const p of hist.data?.points ?? []) now.set(new Date(p.ts).getTime(), p.avg_speed_kph);
    for (const p of summaryHistory) now.set(p.t, p.avg_speed_kph);
    const nowPts: Point[] = [...now.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }));
    const cmp: Point[] = (hist.data?.comparison.points ?? []).map((p) => ({ t: new Date(p.ts).getTime(), v: p.avg_speed_kph }));
    return { nowPts, cmp, cmpLabel: hist.data?.comparison.label ?? 'Previous simulated day' };
  }, [hist.data, summaryHistory]);

  const onSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' ? 1 : -1 }));

  return (
    <div className="stack">
      <div className="filters enter" style={{ '--i': 0 } as React.CSSProperties}>
        <label className="search">
          <Search size={15} aria-hidden="true" />
          <span className="visually-hidden">Find a segment</span>
          <input className="input" type="search" placeholder="Find a road or segment id" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <Segmented<LevelFilter>
          label="Show level"
          value={level}
          onChange={setLevel}
          options={[
            { value: 'all', label: 'All' },
            { value: 'free', label: 'Free' },
            { value: 'moderate', label: 'Moderate' },
            { value: 'heavy', label: 'Heavy' },
            { value: 'severe', label: 'Severe' },
          ]}
        />
        <p className="filters__note muted num">Window ending {fmtShortTime(windowEnd)} IST</p>
      </div>

      <div className="grid grid--stats enter" style={{ '--i': 40 } as React.CSSProperties}>
        <Panel>
          <Stat label="Average speed" value={summary?.avg_speed_kph ?? null} format={fmtSpeed} unit="km/h" note="Length-weighted, all segments" />
        </Panel>
        <Panel>
          <Stat label="Congested road" value={summary?.congested_km ?? null} format={fmtOne} unit="km" note={summary ? `of ${fmtOne(summary.network_km)} km` : undefined} />
        </Panel>
        <Panel>
          <Stat label="Segments worsening" value={network ? worsening : null} format={fmtInt} note="Speed falling 1 km/h per min or faster" tone={worsening > 3 ? 'warn' : undefined} />
        </Panel>
        <Panel>
          <Stat label="Vehicles reporting" value={summary?.vehicles_active ?? null} format={fmtInt} note="In the latest window" />
        </Panel>
      </div>

      <div className="grid grid--2-1">
        <Panel title="Network speed" meta="Last 60 minutes against the same clock time one simulated day earlier" enter={70}>
          {speedSeries.nowPts.length > 1 ? (
            <LineChart
              title="Network average speed"
              unit="km/h"
              yMin={0}
              height={240}
              series={[
                { id: 'now', label: 'Today', color: 'var(--series-1)', points: speedSeries.nowPts },
                ...(speedSeries.cmp.length ? [{ id: 'cmp', label: speedSeries.cmpLabel, color: 'var(--ink-3)', quiet: true, points: speedSeries.cmp }] : []),
              ]}
            />
          ) : hist.isLoading ? (
            <div className="skeleton" style={{ height: 240 }} />
          ) : (
            <Empty title="No history yet">The chart fills as windows close.</Empty>
          )}
        </Panel>
        <Panel title="Road length by level" meta="From the latest window" enter={100}>
          <LevelBar km={km} tall title="Road length by congestion level" />
        </Panel>
      </div>

      <Panel title="Segments" meta={`${rows.length} of ${network?.segments.length ?? 0} shown`} enter={130} bodyClassName="panel__body--flush">
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <SortHeader k="name" label="Segment" sort={sort} onSort={onSort} />
                  <SortHeader k="level" label="Level" sort={sort} onSort={onSort} />
                  <SortHeader k="speed" label="Speed / free flow" sort={sort} onSort={onSort} numeric />
                  <SortHeader k="reduction" label="Below free flow" sort={sort} onSort={onSort} numeric />
                  <SortHeader k="density" label="Density" sort={sort} onSort={onSort} numeric />
                  <SortHeader k="flow" label="Flow" sort={sort} onSort={onSort} numeric />
                  <SortHeader k="trend" label="Trend" sort={sort} onSort={onSort} />
                  <th scope="col">Last 20 min</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ seg, st }) => (
                  <tr key={seg.id} className="table__row--link" onClick={() => setOpen(seg.id)}>
                    <th scope="row">
                      <button type="button" className="rowlink" onClick={(e) => { e.stopPropagation(); setOpen(seg.id); }}>
                        <span className="rowlink__name">{seg.name}</span>
                        <span className="mono muted">{seg.id}</span>
                      </button>
                    </th>
                    <td>
                      <LevelBadge level={st?.level ?? 'no_data'} size="sm" />
                    </td>
                    <td className="num-col">
                      <span className="speedcell num">
                        <span>
                          {fmtSpeed(st?.avg_speed_kph)} <span className="muted">/ {seg.free_flow_kph}</span>
                        </span>
                        <SpeedBullet v={st?.avg_speed_kph ?? null} ff={seg.free_flow_kph} level={st?.level ?? 'no_data'} />
                      </span>
                    </td>
                    <td className="num-col num">{fmtPct(st?.speed_reduction_pct)}</td>
                    <td className="num-col num">
                      {fmtOne(st?.density_veh_per_km)} <span className="muted">veh/km</span>
                    </td>
                    <td className="num-col num">
                      {fmtInt(st?.flow_veh_per_h)} <span className="muted">veh/h</span>
                    </td>
                    <td>{st ? <TrendMark trend={st.trend} slope={st.trend_kph_per_min} /> : <span className="muted">–</span>}</td>
                    <td>
                      <Sparkline points={history[seg.id] ?? []} color="var(--ink-2)" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No segments match">Clear the search or pick another level.</Empty>
        )}
      </Panel>

      <Drawer open={open !== null} onClose={() => setOpen(null)} label="Segment details">
        {open && <SegmentDetail id={open} onClose={() => setOpen(null)} />}
      </Drawer>
    </div>
  );
}
