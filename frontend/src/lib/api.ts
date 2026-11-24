import { STREAM_EVENT_TYPES, type ApiErrorBody, type StreamEventMap, type StreamEventType } from './contract';
import { StreamClient, type ConnectionInfo } from './stream';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;

  constructor(status: number, code: string, message: string, requestId: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export interface StreamHandlers {
  onEvent: <K extends StreamEventType>(type: K, data: StreamEventMap[K], id: string | null) => void;
  onInfo: (info: ConnectionInfo) => void;
  onResync: () => void;
}

/** Everything the app reads goes through one of these: the live API, or design fixtures in development. */
export interface DataSource {
  kind: 'live' | 'fixtures';
  /** Where the data comes from, in words, for the header. */
  label: string;
  get<T>(path: string, signal?: AbortSignal): Promise<T>;
  post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T>;
  connect(handlers: StreamHandlers): () => void;
}

const API_PREFIX = '/api/v1';

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, 'invalid_response', `The API sent something that is not JSON (HTTP ${res.status}).`);
    }
  }
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? `http_${res.status}`,
      err?.message ?? `The API answered HTTP ${res.status}.`,
      err?.request_id ?? null,
    );
  }
  return body as T;
}

export function createLiveSource(baseUrl: string): DataSource {
  const root = baseUrl.replace(/\/$/, '') + API_PREFIX;

  async function request<T>(path: string, init: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(root + path, { ...init, headers: { Accept: 'application/json', ...init.headers } });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new ApiError(0, 'network_error', `Cannot reach the Arterial API at ${baseUrl || 'this origin'}.`);
    }
    return parse<T>(res);
  }

  return {
    kind: 'live',
    label: 'Simulated telemetry',
    get: (path, signal) => request(path, { method: 'GET', signal }),
    post: (path, body, signal) =>
      request(path, {
        method: 'POST',
        signal,
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      }),
    connect(handlers) {
      const client = new StreamClient({
        url: `${root}/stream`,
        eventTypes: STREAM_EVENT_TYPES,
        onEvent: (type, data, id) => handlers.onEvent(type as StreamEventType, data as never, id),
        onInfo: handlers.onInfo,
        onResync: handlers.onResync,
      });
      client.start();
      return () => client.stop();
    },
  };
}
