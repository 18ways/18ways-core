import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _reset18waysRequestStateForTests, fetchAcceptedLocales, init } from '../common';

describe('fetchAcceptedLocales', () => {
  beforeEach(() => {
    _reset18waysRequestStateForTests();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        languages: [{ code: 'en-GB' }, { code: 'ja-JP' }],
      }),
    }) as typeof fetch;
  });

  it('passes origin header when an origin is provided', async () => {
    init({
      key: 'test-public-api-key',
      cacheTtlSeconds: 0,
    });
    await fetchAcceptedLocales('en-GB', { origin: 'https://18ways.com' });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'x-api-key': 'test-public-api-key',
          origin: 'https://18ways.com',
        }),
      })
    );
  });

  it('uses the provided api url instead of package env state', async () => {
    init({
      key: 'api-key-from-ways-props',
      apiUrl: 'https://preview.18ways.com/api',
      cacheTtlSeconds: 0,
    });
    await fetchAcceptedLocales('en-GB', { origin: 'https://18ways.com' });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      'https://preview.18ways.com/api/config',
      expect.objectContaining({
        method: 'GET',
      })
    );
  });

  it('uses the configured global ttl when decorating cached accepted-locale requests', async () => {
    const requestInitDecorator = vi.fn(({ requestInit, cacheTtlSeconds }) => ({
      ...requestInit,
      frameworkCache: { ttl: cacheTtlSeconds },
    }));

    init({
      key: 'test-public-api-key',
      _requestInitDecorator: requestInitDecorator,
    });
    await fetchAcceptedLocales('en-GB', { origin: 'https://18ways.com' });

    expect(requestInitDecorator).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        cacheTtlSeconds: 600,
      })
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'GET',
        cache: 'force-cache',
        frameworkCache: { ttl: 600 },
      })
    );
  });

  it('does not keep an extra in-memory cache for repeated keyed requests', async () => {
    init({
      key: 'test-public-api-key',
    });
    await fetchAcceptedLocales('en-GB', { origin: 'https://18ways.com' });
    await fetchAcceptedLocales('en-GB', { origin: 'https://18ways.com' });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('always prepends the base locale to the accepted-locale list', async () => {
    init({
      key: 'test-public-api-key',
      cacheTtlSeconds: 0,
    });
    const locales = await fetchAcceptedLocales('en-US', { origin: 'https://18ways.com' });

    expect(locales).toEqual(['en-US', 'en-GB', 'ja-JP']);
  });

  it('falls back to the default locale without fetching when no api key is available', async () => {
    const locales = await fetchAcceptedLocales('en-GB');

    expect(locales).toEqual(['en-GB']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns a synthetic Caesar locale for the demo token without fetching', async () => {
    init({
      key: 'pk_dummy_demo_token',
    });
    const locales = await fetchAcceptedLocales('en-US');

    expect(locales).toEqual(['en-US', 'en-US-x-caesar']);
    expect(fetch).not.toHaveBeenCalled();
  });
});
