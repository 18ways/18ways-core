import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchEnabledLanguages, fetchSeed, init } from '../common';

describe('common - cache ttl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses default revalidate value when cache ttl is not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ languages: [], total: 0 }),
    });

    init({
      key: 'test-api-key',
      fetcher: fetchMock as typeof fetch,
    });

    await fetchEnabledLanguages();

    const call = fetchMock.mock.calls[0];
    expect(call[1].next.revalidate).toBe(600);
    expect(call[1].cache).toBe('force-cache');
    expect(call[0]).toContain('/api/enabled-languages');
  });

  it('uses custom revalidate value when cache ttl is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ languages: [], total: 0 }),
    });

    init({
      key: 'test-api-key',
      fetcher: fetchMock as typeof fetch,
      cacheTtlSeconds: 90,
    });

    await fetchEnabledLanguages();

    const call = fetchMock.mock.calls[0];
    expect(call[1].next.revalidate).toBe(90);
    expect(call[1].cache).toBe('force-cache');
  });

  it('does not apply Next cache options to POST requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {}, errors: [] }),
    });

    init({
      key: 'test-api-key',
      fetcher: fetchMock as typeof fetch,
      cacheTtlSeconds: 90,
    });

    await fetchSeed(['key-1'], 'es-ES');

    const call = fetchMock.mock.calls[0];
    expect(call[1].method).toBe('POST');
    expect(call[1].next).toBeUndefined();
    expect(call[1].cache).toBeUndefined();
  });

  it('sends origin on server-side requests when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {}, errors: [] }),
    });

    init({
      key: 'test-api-key',
      fetcher: fetchMock as typeof fetch,
      origin: 'https://18ways.com',
    });

    await fetchSeed(['key-1'], 'es-ES');

    const call = fetchMock.mock.calls[0];
    expect(call[1].headers.origin).toBe('https://18ways.com');
  });
});
