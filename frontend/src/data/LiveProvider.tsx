import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { DataSource } from '../lib/api';
import type {
  CongestionAlert,
  Incident,
  NetworkSummary,
  PredictionSet,
  RoadNetwork,
  SegmentState,
  SystemStatus,
  ThroughputPoint,
} from '../lib/contract';
import { useLive } from './store';

const SourceContext = createContext<DataSource | null>(null);

export function useSource(): DataSource {
  const source = useContext(SourceContext);
  if (!source) throw new Error('useSource must be used inside <LiveProvider>');
  return source;
}

async function optional<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return null;
  }
}

/** Loads REST snapshots once something needs them, then keeps the store current from the stream. */
export function LiveProvider({ source, children }: { source: DataSource; children: ReactNode }) {
  // started by the console (and by the landing on design fixtures); the live landing reads /corridors instead
  const wanted = useLive((s) => s.wanted);
  useEffect(() => {
    if (!wanted) return;
    const store = useLive.getState();
    let ctrl = new AbortController();
    let loading = false;

    async function bootstrap() {
      if (loading) return;
      loading = true;
      ctrl.abort();
      ctrl = new AbortController();
      const { signal } = ctrl;
      store.setBootstrap('loading');
      try {
        const [network, segs] = await Promise.all([
          source.get<RoadNetwork>('/network', signal),
          source.get<{ states: SegmentState[] }>('/traffic/segments', signal),
        ]);
        const [summary, alerts, incidents, predictions, system, throughput] = await Promise.all([
          optional(source.get<NetworkSummary>('/traffic/summary', signal)),
          optional(source.get<{ alerts: CongestionAlert[] }>('/alerts?status=all&limit=60', signal)),
          optional(source.get<{ incidents: Incident[] }>('/incidents?status=all&limit=100', signal)),
          optional(source.get<PredictionSet>('/predictions', signal)),
          optional(source.get<SystemStatus>('/system/status', signal)),
          optional(source.get<{ points: ThroughputPoint[] }>('/system/throughput?minutes=15', signal)),
        ]);
        if (signal.aborted) return;
        useLive.getState().setSnapshot({
          network,
          states: segs.states,
          summary,
          alerts: alerts?.alerts ?? [],
          incidents: incidents?.incidents ?? [],
          predictions,
          system,
          throughput: throughput?.points ?? [],
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        useLive.getState().setBootstrap('error', (err as Error).message);
      } finally {
        loading = false;
      }
    }

    void bootstrap();

    const disconnect = source.connect({
      onEvent: (type, data, id) => useLive.getState().receive(type, data, id),
      onInfo: (info) => {
        useLive.getState().setConnection(info);
        // The API came back after a failed first load: load the snapshots now.
        if (info.state === 'live' && useLive.getState().bootstrap.status === 'error') void bootstrap();
      },
      onResync: () => void bootstrap(),
    });

    return () => {
      ctrl.abort();
      disconnect();
      useLive.getState().reset();
    };
  }, [source, wanted]);

  return <SourceContext.Provider value={source}>{children}</SourceContext.Provider>;
}
