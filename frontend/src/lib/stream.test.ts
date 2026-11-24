import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamClient, backoffDelay, withLastEventId, type ConnectionInfo, type EventSourceLike, type MessageLike } from './stream';

class FakeEventSource implements EventSourceLike {
  static all: FakeEventSource[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  listeners = new Map<string, ((ev: MessageLike) => void)[]>();
  constructor(public url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, l: (ev: MessageLike) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.(new Event('open'));
  }
  fail() {
    this.onerror?.(new Event('error'));
  }
  emit(type: string, data: string, id = '') {
    for (const l of this.listeners.get(type) ?? []) l({ data, lastEventId: id });
  }
}

function setup(overrides: Partial<ConstructorParameters<typeof StreamClient>[0]> = {}) {
  const events: [string, unknown, string | null][] = [];
  const infos: ConnectionInfo[] = [];
  const resync = vi.fn();
  const client = new StreamClient({
    url: 'http://api.test/api/v1/stream',
    eventTypes: ['segments', 'heartbeat'],
    onEvent: (t, d, id) => events.push([t, d, id]),
    onInfo: (i) => infos.push(i),
    onResync: resync,
    createEventSource: (url) => new FakeEventSource(url),
    random: () => 0.5, // no jitter
    ...overrides,
  });
  return { client, events, infos, resync, last: () => FakeEventSource.all[FakeEventSource.all.length - 1] };
}

describe('backoffDelay', () => {
  const opts = { initialMs: 1000, maxMs: 30_000, factor: 2, jitter: 0.3 };
  it('doubles from the initial delay and caps at the maximum', () => {
    expect(backoffDelay(1, opts, () => 0.5)).toBe(1000);
    expect(backoffDelay(2, opts, () => 0.5)).toBe(2000);
    expect(backoffDelay(4, opts, () => 0.5)).toBe(8000);
    expect(backoffDelay(10, opts, () => 0.5)).toBe(30_000);
  });
  it('keeps jitter inside its band', () => {
    expect(backoffDelay(3, opts, () => 0)).toBe(2800);
    expect(backoffDelay(3, opts, () => 1)).toBe(5200);
  });
});

describe('withLastEventId', () => {
  it('adds the id as a query parameter only when there is one', () => {
    expect(withLastEventId('http://x/stream', null)).toBe('http://x/stream');
    expect(withLastEventId('http://x/stream', '42')).toBe('http://x/stream?last_event_id=42');
    expect(withLastEventId('http://x/stream?a=1', '42')).toBe('http://x/stream?a=1&last_event_id=42');
  });
});

describe('StreamClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.all = [];
  });
  afterEach(() => vi.useRealTimers());

  it('goes live on open and delivers parsed events with their ids', () => {
    const { client, events, infos, last } = setup();
    client.start();
    expect(infos.at(-1)?.state).toBe('connecting');
    last().open();
    expect(infos.at(-1)?.state).toBe('live');
    last().emit('segments', '{"window_end":"2026-11-28T10:00:00Z","states":[]}', '7');
    expect(events).toEqual([['segments', { window_end: '2026-11-28T10:00:00Z', states: [] }, '7']]);
  });

  it('reconnects with backoff after an error and resumes from the last event id', () => {
    const { client, infos, last } = setup();
    client.start();
    last().open();
    last().emit('heartbeat', '{"ts":"x"}', '41');
    const first = last();
    first.fail();
    expect(first.closed).toBe(true);
    expect(infos.at(-1)).toMatchObject({ state: 'reconnecting', attempt: 1, nextRetryMs: 1000 });
    vi.advanceTimersByTime(999);
    expect(FakeEventSource.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.all).toHaveLength(2);
    expect(last().url).toBe('http://api.test/api/v1/stream?last_event_id=41');
    last().open();
    expect(infos.at(-1)).toMatchObject({ state: 'live', attempt: 0 });
  });

  it('treats silence past the heartbeat timeout as a dead connection', () => {
    const { client, infos, last } = setup({ heartbeatTimeoutMs: 15_000 });
    client.start();
    last().open();
    vi.advanceTimersByTime(14_000);
    last().emit('heartbeat', '{"ts":"x"}', '1');
    vi.advanceTimersByTime(14_000);
    expect(infos.at(-1)?.state).toBe('live');
    vi.advanceTimersByTime(1_001);
    expect(infos.at(-1)).toMatchObject({ state: 'reconnecting', error: 'No events for 15 s' });
  });

  it('reads offline after repeated failures but keeps retrying', () => {
    const { client, infos, last } = setup({ offlineAfter: 3 });
    client.start();
    for (let i = 0; i < 3; i++) {
      last().fail();
      vi.runOnlyPendingTimers();
    }
    expect(infos.filter((i) => i.state === 'offline').length).toBeGreaterThan(0);
    expect(FakeEventSource.all.length).toBe(4);
  });

  it('skips a malformed frame without dropping the stream', () => {
    const { client, events, infos, last } = setup();
    client.start();
    last().open();
    last().emit('segments', '{not json', '3');
    expect(events).toHaveLength(0);
    expect(infos.at(-1)).toMatchObject({ state: 'live', error: 'Malformed segments event skipped' });
    last().emit('segments', '{"window_end":"t","states":[]}', '4');
    expect(events).toHaveLength(1);
  });

  it('asks for a resync when the server says so', () => {
    const { client, resync, last } = setup();
    client.start();
    last().open();
    last().emit('resync', '{}');
    expect(resync).toHaveBeenCalledOnce();
  });

  it('stops cleanly: no retries after stop', () => {
    const { client, infos, last } = setup();
    client.start();
    last().fail();
    client.stop();
    vi.runAllTimers();
    expect(FakeEventSource.all).toHaveLength(1);
    expect(infos.at(-1)?.state).toBe('idle');
  });

  it('ignores events from a source it already replaced', () => {
    const { client, events, last } = setup();
    client.start();
    const old = last();
    old.open();
    old.fail();
    vi.runOnlyPendingTimers();
    old.emit('segments', '{"window_end":"t","states":[]}', '9');
    expect(events).toHaveLength(0);
  });
});
