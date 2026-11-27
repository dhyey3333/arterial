import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  AnalyticsOverview,
  Incident,
  ModelInfo,
  PlaceSearch,
  RouteRequest,
  RouteResponse,
  SegmentDetail,
  TrafficHistory,
} from '../lib/contract';
import { useSource } from './LiveProvider';

export function useTrafficHistory(minutes = 60) {
  const source = useSource();
  return useQuery({
    queryKey: ['traffic-history', source.kind, minutes],
    queryFn: ({ signal }) => source.get<TrafficHistory>(`/traffic/history?minutes=${minutes}`, signal),
    // History is a REST read of stored windows; the live tail comes from the stream.
    staleTime: 60_000,
  });
}

export function useSegmentDetail(id: string | null, minutes = 60) {
  const source = useSource();
  return useQuery({
    queryKey: ['segment', source.kind, id, minutes],
    queryFn: ({ signal }) => source.get<SegmentDetail>(`/traffic/segments/${encodeURIComponent(id!)}?minutes=${minutes}`, signal),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

/** Places in the region matching `q` (two characters or more), for the route search. */
export function usePlaces(q: string) {
  const source = useSource();
  const query = q.trim();
  return useQuery({
    queryKey: ['places', source.kind, query.toLowerCase()],
    queryFn: ({ signal }) => source.get<PlaceSearch>(`/places?q=${encodeURIComponent(query)}&limit=8`, signal),
    enabled: query.length >= 2,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useModelInfo() {
  const source = useSource();
  return useQuery({
    queryKey: ['model', source.kind],
    queryFn: ({ signal }) => source.get<ModelInfo>('/predictions/model', signal),
    staleTime: 5 * 60_000,
  });
}

export function useIncident(id: string | null) {
  const source = useSource();
  return useQuery({
    queryKey: ['incident', source.kind, id],
    queryFn: ({ signal }) => source.get<Incident>(`/incidents/${encodeURIComponent(id!)}`, signal),
    enabled: Boolean(id),
  });
}

export function useAnalytics(days: number) {
  const source = useSource();
  return useQuery({
    queryKey: ['analytics', source.kind, days],
    queryFn: ({ signal }) => source.get<AnalyticsOverview>(`/analytics/overview?days=${days}`, signal),
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useRoute() {
  const source = useSource();
  return useMutation({
    mutationFn: (req: RouteRequest) => source.post<RouteResponse>('/routes', req),
  });
}
