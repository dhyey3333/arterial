/**
 * Server-Sent Events client with the reconnect behaviour docs/API.md promises:
 * exponential backoff with jitter, a heartbeat watchdog, and resume from the
 * last event id. The browser's own EventSource retry is not used, because it
 * gives no control over backoff and no "offline" state to show the operator.
 */

export type ConnectionState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface ConnectionInfo {
  state: ConnectionState;
  attempt: number;
  nextRetryMs: number | null;
  lastEventId: string | null;
  error: string | null;
}

export interface MessageLike {
  data: string;
  lastEventId: string;
}

/** The slice of EventSource the client uses, so tests can pass a fake. */
export interface EventSourceLike {
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  addEventListener(type: string, listener: (ev: MessageLike) => void): void;
  close(): void;
}

export interface BackoffOptions {
  initialMs: number;
  maxMs: number;
  factor: number;
  /** 0..1 share of the delay that is randomised. */
  jitter: number;
}

export interface StreamClientOptions {
  url: string;
  eventTypes: readonly string[];
  onEvent: (type: string, data: unknown, id: string | null) => void;
  onInfo: (info: ConnectionInfo) => void;
  onResync?: () => void;
  createEventSource?: (url: string) => EventSourceLike;
  heartbeatTimeoutMs?: number;
  backoff?: Partial<BackoffOptions>;
  /** Attempts in a row before the state reads "offline" instead of "reconnecting". */
  offlineAfter?: number;
  random?: () => number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { initialMs: 1000, maxMs: 30_000, factor: 2, jitter: 0.3 };

/** Delay before reconnect attempt `attempt` (1-based). */
export function backoffDelay(attempt: number, opts: BackoffOptions, random: () => number = Math.random): number {
  const base = Math.min(opts.maxMs, opts.initialMs * opts.factor ** Math.max(0, attempt - 1));
  const spread = base * opts.jitter;
  return Math.max(0, Math.round(base - spread + random() * spread * 2));
}

export function withLastEventId(url: string, id: string | null): string {
  if (!id) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}last_event_id=${encodeURIComponent(id)}`;
}

export class StreamClient {
  private readonly opts: Required<Omit<StreamClientOptions, 'onResync' | 'backoff'>> & {
    onResync?: () => void;
    backoff: BackoffOptions;
  };
  private source: EventSourceLike | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private lastEventId: string | null = null;
  private state: ConnectionState = 'idle';
  private stopped = true;

  constructor(options: StreamClientOptions) {
    this.opts = {
      createEventSource: (url) => new EventSource(url) as unknown as EventSourceLike,
      heartbeatTimeoutMs: 15_000,
      offlineAfter: 4,
      random: Math.random,
      ...options,
      backoff: { ...DEFAULT_BACKOFF, ...options.backoff },
    };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open('connecting');
  }

  stop(): void {
    this.stopped = true;
    this.teardown();
    this.clearRetry();
    this.emit('idle', null, null);
  }

  get info(): ConnectionInfo {
    return { state: this.state, attempt: this.attempt, nextRetryMs: null, lastEventId: this.lastEventId, error: null };
  }

  private open(state: ConnectionState): void {
    this.teardown();
    this.emit(state, null, null);
    let es: EventSourceLike;
    try {
      es = this.opts.createEventSource(withLastEventId(this.opts.url, this.lastEventId));
    } catch (err) {
      this.scheduleRetry(err instanceof Error ? err.message : 'Could not open the stream');
      return;
    }
    this.source = es;
    es.onopen = () => {
      if (this.source !== es) return;
      this.attempt = 0;
      this.emit('live', null, null);
      this.armWatchdog();
    };
    es.onerror = () => {
      if (this.source !== es) return;
      this.scheduleRetry('The stream closed');
    };
    for (const type of this.opts.eventTypes) {
      es.addEventListener(type, (ev) => this.handle(es, type, ev));
    }
    es.addEventListener('resync', () => {
      if (this.source !== es) return;
      this.opts.onResync?.();
    });
    this.armWatchdog();
  }

  private handle(es: EventSourceLike, type: string, ev: MessageLike): void {
    if (this.source !== es) return;
    if (ev.lastEventId) this.lastEventId = ev.lastEventId;
    if (this.state !== 'live') {
      this.attempt = 0;
      this.emit('live', null, null);
    }
    this.armWatchdog();
    let data: unknown;
    try {
      data = JSON.parse(ev.data);
    } catch {
      // A malformed frame is reported but never kills the stream.
      this.opts.onInfo({ ...this.info, error: `Malformed ${type} event skipped` });
      return;
    }
    this.opts.onEvent(type, data, ev.lastEventId || null);
  }

  private armWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      this.scheduleRetry(`No events for ${Math.round(this.opts.heartbeatTimeoutMs / 1000)} s`);
    }, this.opts.heartbeatTimeoutMs);
  }

  private scheduleRetry(reason: string): void {
    if (this.stopped) return;
    this.teardown();
    this.clearRetry();
    this.attempt += 1;
    const delay = backoffDelay(this.attempt, this.opts.backoff, this.opts.random);
    const state: ConnectionState = this.attempt >= this.opts.offlineAfter ? 'offline' : 'reconnecting';
    this.emit(state, delay, reason);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) this.open(state);
    }, delay);
  }

  private teardown(): void {
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    if (this.source) {
      const es = this.source;
      this.source = null;
      es.onopen = null;
      es.onerror = null;
      es.close();
    }
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private emit(state: ConnectionState, nextRetryMs: number | null, error: string | null): void {
    this.state = state;
    this.opts.onInfo({ state, attempt: this.attempt, nextRetryMs, lastEventId: this.lastEventId, error });
  }
}
