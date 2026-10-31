import { describe, expect, it, vi } from 'vitest';
import { fetchWithAuth, isSessionRejected, singleFlight } from './api';
import { ApiFailure } from './errors';

const reply = (status: number) => new Response('{}', { status });

describe('fetchWithAuth', () => {
  it('sends the access token and returns the response', async () => {
    const fetchImpl = vi.fn(async () => reply(200));
    const response = await fetchWithAuth('https://api.test/x', { method: 'POST', headers: { Accept: 'application/json' } }, {
      getAccessToken: async () => 'tok-1',
      refreshAccessToken: async () => { throw new Error('should not refresh'); },
      fetchImpl,
    });
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer tok-1' });
  });

  it('retries once with a refreshed token after a 401', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => ((init?.headers as Record<string, string>).Authorization === 'Bearer old' ? reply(401) : reply(200)));
    const refresh = vi.fn(async (rejected: string) => { expect(rejected).toBe('old'); return 'new'; });
    const response = await fetchWithAuth('https://api.test/x', {}, { getAccessToken: async () => 'old', refreshAccessToken: refresh, fetchImpl });
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not retry a second time when the fresh token is refused too', async () => {
    const fetchImpl = vi.fn(async () => reply(401));
    const refresh = vi.fn(async () => 'new');
    const response = await fetchWithAuth('https://api.test/x', {}, { getAccessToken: async () => 'old', refreshAccessToken: refresh, fetchImpl });
    expect(response.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each([400, 403, 404, 415, 500])('does not refresh or retry on %i', async (status) => {
    const fetchImpl = vi.fn(async () => reply(status));
    const refresh = vi.fn(async () => 'new');
    const response = await fetchWithAuth('https://api.test/x', {}, { getAccessToken: async () => 'old', refreshAccessToken: refresh, fetchImpl });
    expect(response.status).toBe(status);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('surfaces a refresh failure instead of calling the API again', async () => {
    const fetchImpl = vi.fn(async () => reply(401));
    await expect(fetchWithAuth('https://api.test/x', {}, {
      getAccessToken: async () => 'old',
      refreshAccessToken: async () => { throw new ApiFailure('Extension session expired.', 401); },
      fetchImpl,
    })).rejects.toThrow('Extension session expired.');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not call the API when nobody is signed in', async () => {
    const fetchImpl = vi.fn(async () => reply(200));
    await expect(fetchWithAuth('https://api.test/x', {}, {
      getAccessToken: async () => { throw new Error('Sign in to OpenAssets to use the extension.'); },
      refreshAccessToken: async () => 'x',
      fetchImpl,
    })).rejects.toThrow('Sign in');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('singleFlight', () => {
  it('runs one task for parallel callers and a new one afterwards', async () => {
    let release: (value: string) => void = () => undefined;
    const task = vi.fn(() => new Promise<string>((resolve) => { release = resolve; }));
    const run = singleFlight(task);
    const first = run();
    const second = run();
    expect(task).toHaveBeenCalledTimes(1);
    release('a');
    expect(await first).toBe('a');
    expect(await second).toBe('a');
    const third = run();
    expect(task).toHaveBeenCalledTimes(2);
    release('b');
    expect(await third).toBe('b');
  });

  it('lets the next call start again after a failure', async () => {
    const task = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('ok');
    const run = singleFlight(task);
    await expect(run()).rejects.toThrow('offline');
    await expect(run()).resolves.toBe('ok');
    expect(task).toHaveBeenCalledTimes(2);
  });
});

describe('isSessionRejected', () => {
  it('is true only when the server turned the session down', () => {
    expect(isSessionRejected(new ApiFailure('Extension session expired.', 401))).toBe(true);
    expect(isSessionRejected(new ApiFailure('Forbidden', 403))).toBe(true);
  });

  it('is false for a network error, a server error or anything else', () => {
    expect(isSessionRejected(new TypeError('Failed to fetch'))).toBe(false);
    expect(isSessionRejected(new ApiFailure('Internal Server Error', 500))).toBe(false);
    expect(isSessionRejected(new ApiFailure('Bad gateway', 502))).toBe(false);
    expect(isSessionRejected(new Error('x'))).toBe(false);
    expect(isSessionRejected(undefined)).toBe(false);
  });
});
