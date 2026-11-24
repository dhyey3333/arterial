import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createLiveSource } from './api';

function respond(status: number, body: string) {
  return vi.fn().mockResolvedValue(new Response(body, { status, headers: { 'Content-Type': 'application/json' } }));
}

describe('createLiveSource', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls the versioned API and returns JSON', async () => {
    const fetch = respond(200, '{"status":"ok"}');
    vi.stubGlobal('fetch', fetch);
    const src = createLiveSource('http://api.test/');
    await expect(src.get('/health')).resolves.toEqual({ status: 'ok' });
    expect(fetch.mock.calls[0][0]).toBe('http://api.test/api/v1/health');
  });

  it('turns a structured error body into an ApiError', async () => {
    vi.stubGlobal('fetch', respond(404, '{"error":{"code":"segment_not_found","message":"No segment X.","request_id":"r1"}}'));
    const err = await createLiveSource('').get('/traffic/segments/X').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: 'segment_not_found', message: 'No segment X.', requestId: 'r1' });
  });

  it('reports a body that is not JSON instead of crashing', async () => {
    vi.stubGlobal('fetch', respond(502, '<html>Bad gateway</html>'));
    const err = await createLiveSource('').get('/network').catch((e) => e);
    expect(err).toMatchObject({ code: 'invalid_response', status: 502 });
  });

  it('reports an unreachable API as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await createLiveSource('http://down.test').get('/network').catch((e) => e);
    expect(err).toMatchObject({ code: 'network_error', status: 0 });
  });

  it('posts JSON for routes', async () => {
    const fetch = respond(200, '{"ok":true}');
    vi.stubGlobal('fetch', fetch);
    await createLiveSource('').post('/routes', { origin: 'N1', destination: 'N2' });
    const [, init] = fetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ origin: 'N1', destination: 'N2' });
  });
});
