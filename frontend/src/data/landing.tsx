import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { ModelInfo, Prediction, SegmentLevel, SystemStatus } from '../lib/contract';
import { useSource } from './LiveProvider';
import { useLive } from './store';

/** GET /api/v1/corridors: the landing's 21 Bengaluru corridors, each averaged from the live segments under it. */
export interface CorridorView {
  as_of: string;
  region: string | null;
  made_at: string | null;
  model: ModelInfo | null;
  now: Record<string, SegmentLevel>;
  predictions: Prediction[];
  vehicles: number;
  system: SystemStatus | null;
}

export interface LandingData {
  /** live: the API answered; waiting: it has not (yet); fixtures: design fixtures in development. */
  status: 'live' | 'waiting' | 'fixtures';
  now: Record<string, SegmentLevel> | null;
  predictions: Prediction[] | null;
  madeAt: string | null;
  model: ModelInfo | null;
  system: SystemStatus | null;
}

const LandingContext = createContext<LandingData | null>(null);

/**
 * What the landing shows. Live, it polls /corridors every 10 s: a few kilobytes, where the console's
 * network is the whole country. On design fixtures it reads the store, as before.
 */
export function LandingDataProvider({ children }: { children: ReactNode }) {
  const source = useSource();
  const live = source.kind === 'live';
  useEffect(() => {
    if (!live) useLive.getState().want();
  }, [live]);

  const q = useQuery({
    queryKey: ['corridors'],
    queryFn: ({ signal }) => source.get<CorridorView>('/corridors', signal),
    enabled: live,
    refetchInterval: 10_000,
    retry: false,
  });

  const states = useLive((s) => s.states);
  const predictionSet = useLive((s) => s.predictions);
  const system = useLive((s) => s.system);

  const value = useMemo<LandingData>(() => {
    if (!live) {
      const ids = Object.keys(states);
      const now: Record<string, SegmentLevel> = {};
      for (const id of ids) now[id] = states[id].level;
      return {
        status: 'fixtures',
        now: ids.length ? now : null,
        predictions: predictionSet?.predictions ?? null,
        madeAt: predictionSet?.made_at ?? null,
        model: predictionSet?.model ?? null,
        system,
      };
    }
    const d = q.data;
    if (!d) return { status: 'waiting', now: null, predictions: null, madeAt: null, model: null, system: null };
    const anyNow = Object.values(d.now).some((l) => l !== 'no_data');
    // live while the last answer is recent: one slow poll should not flip the readout to "down"
    const fresh = Date.now() - q.dataUpdatedAt < 35_000;
    return {
      status: fresh ? 'live' : 'waiting',
      now: anyNow ? d.now : null,
      predictions: d.predictions.length ? d.predictions : null,
      madeAt: d.made_at,
      model: d.model,
      system: d.system,
    };
  }, [live, q.data, q.dataUpdatedAt, states, predictionSet, system]);

  return <LandingContext.Provider value={value}>{children}</LandingContext.Provider>;
}

export function useLanding(): LandingData {
  const v = useContext(LandingContext);
  if (!v) throw new Error('useLanding must be used inside <LandingDataProvider>');
  return v;
}
