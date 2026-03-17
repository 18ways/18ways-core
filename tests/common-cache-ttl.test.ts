import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decryptTranslationValue } from '../crypto';
import { fetchConfig, fetchSeed, fetchTranslations, init } from '../common';

describe('common - cache ttl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses generic force-cache semantics for GET requests by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        languages: [],
        total: 0,
        translationFallback: { default: 'source', overrides: [] },
      }),
    });

    init({
      key: 'test-api-key',
      fetcher: fetchMock as typeof fetch,
    });

    await fetchConfig();

    const call = fetchMock.mock.calls[0];
    expect(call[1].cache).toBe('force-cache');
    expect(call[0]).toContain('/api/config');
  });

  it('switches GET requests to no-store when cache ttl is zero', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        languages: [],
        total: 0,
        translationFallback: { default: 'source', overrides: [] },
      }),
    });

    init({
      key: 'test-api-key',
      fetcher: fetchMock as typeof fetch,
      cacheTtlSeconds: 0,
    });

    await fetchConfig();

    const call = fetchMock.mock.calls[0];
    expect(call[1].cache).toBe('no-store');
  });

  it('allows callers to decorate request init in a framework-specific way', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        languages: [],
        total: 0,
        translationFallback: { default: 'source', overrides: [] },
      }),
    });
    const requestInitDecorator = vi.fn(({ requestInit, cacheTtlSeconds }) => ({
      ...requestInit,
      frameworkCache: { ttl: cacheTtlSeconds },
    }));

    init({
      key: 'test-api-key',
      fetcher: fetchMock as typeof fetch,
      cacheTtlSeconds: 90,
      _requestInitDecorator: requestInitDecorator,
    });

    await fetchConfig();

    expect(requestInitDecorator).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        cacheTtlSeconds: 90,
      })
    );
    const call = fetchMock.mock.calls[0];
    expect(call[1].frameworkCache).toEqual({ ttl: 90 });
  });

  it('does not apply GET cache semantics to POST requests', async () => {
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

  it('serves demo config locally for the demo token', async () => {
    const fetchMock = vi.fn();

    init({
      key: 'pk_dummy_demo_token',
      baseLocale: 'en-US',
      fetcher: fetchMock as typeof fetch,
    });

    const config = await fetchConfig();

    expect(config.languages).toEqual([
      {
        code: 'en-US',
        name: 'en-US',
        nativeName: 'en-US',
      },
      {
        code: 'en-US-x-caesar',
        name: 'Caesar Shift',
        nativeName: 'Caesar Shift',
        flag: '🔄',
      },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves rot13 translations locally for the demo token', async () => {
    const fetchMock = vi.fn();

    init({
      key: 'pk_dummy_demo_token',
      baseLocale: 'en-US',
      fetcher: fetchMock as typeof fetch,
    });

    const result = await fetchTranslations([
      {
        key: 'app',
        textHash: 'hash-1',
        baseLocale: 'en-US',
        targetLocale: 'en-US-x-caesar',
        text: 'Hello <link>world</link>',
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.data).toHaveLength(1);
    expect(
      decryptTranslationValue({
        encryptedText: result.data[0].translation,
        sourceText: 'Hello <link>world</link>',
        locale: 'en-US-x-caesar',
        key: 'app',
        textHash: 'hash-1',
      })
    ).toEqual('Uryyb <link>jbeyq</link>');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
