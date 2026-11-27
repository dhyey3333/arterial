import { useMemo } from 'react';
import type { Prediction, SegmentLevel } from '../lib/contract';
import { LEVEL_RANK } from '../lib/format';
import { useLive } from './store';

/** Kilometres of road at each congestion level in the latest window. */
export function useKmByLevel(): Record<SegmentLevel, number> {
  const network = useLive((s) => s.network);
  const states = useLive((s) => s.states);
  return useMemo(() => {
    const out: Record<SegmentLevel, number> = { free: 0, moderate: 0, heavy: 0, severe: 0, no_data: 0 };
    for (const s of network?.segments ?? []) out[states[s.id]?.level ?? 'no_data'] += s.length_m / 1000;
    return out;
  }, [network, states]);
}

/**
 * The roads forecast to get worse at one horizon, riskiest first: a level worse than now, or a high risk
 * score with a real drop in speed. The console's "Likely to slow" list and the landing's panel both read
 * this, so they always name the same roads.
 */
export function useAtRisk(horizon = 10, limit = 4): Prediction[] {
  const predictions = useLive((s) => s.predictions);
  const states = useLive((s) => s.states);
  return useMemo(() => {
    const now: Record<string, SegmentLevel> = {};
    for (const id in states) now[id] = states[id].level;
    return pickAtRisk(predictions?.predictions ?? null, now, horizon, limit);
  }, [predictions, states, horizon, limit]);
}

/** The same rule without the store: the landing feeds it its corridors. */
export function pickAtRisk(predictions: Prediction[] | null, now: Record<string, SegmentLevel>, horizon = 10, limit = 4): Prediction[] {
  if (!predictions) return [];
  return predictions
    .filter((p) => p.horizon_min === horizon)
    .filter((p) => LEVEL_RANK[p.predicted_level] > LEVEL_RANK[now[p.segment_id] ?? 'no_data'] || (p.risk >= 0.5 && p.expected_change_kph <= -2))
    .sort((a, b) => b.risk - a.risk || a.expected_change_kph - b.expected_change_kph)
    .slice(0, limit);
}
