import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAcceptedLocales } from '../common';

describe('fetchAcceptedLocales', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        languages: [{ code: 'en-GB' }, { code: 'ja-JP' }],
      }),
    }) as typeof fetch;
  });

  it('passes origin header when an origin is provided', async () => {
    await fetchAcceptedLocales('en-GB', {
      forceRefresh: true,
      origin: 'https://18ways.com',
      apiKey: 'test-public-api-key',
    });

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
    await fetchAcceptedLocales('en-GB', {
      forceRefresh: true,
      apiUrl: 'https://preview.18ways.com/api',
      origin: 'https://18ways.com',
      apiKey: 'api-key-from-ways-props',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      'https://preview.18ways.com/api/enabled-languages',
      expect.objectContaining({
        method: 'GET',
      })
    );
  });

  it('uses a 1 minute ttl when decorating cached accepted-locale requests', async () => {
    const requestInitDecorator = vi.fn(({ requestInit, cacheTtlSeconds }) => ({
      ...requestInit,
      frameworkCache: { ttl: cacheTtlSeconds },
    }));

    await fetchAcceptedLocales('en-GB', {
      origin: 'https://18ways.com',
      apiKey: 'test-public-api-key',
      _requestInitDecorator: requestInitDecorator,
    });

    expect(requestInitDecorator).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        cacheTtlSeconds: 60,
      })
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'GET',
        cache: 'force-cache',
        frameworkCache: { ttl: 60 },
      })
    );
  });

  it('does not keep an extra in-memory cache for repeated keyed requests', async () => {
    await fetchAcceptedLocales('en-GB', {
      origin: 'https://18ways.com',
      apiKey: 'test-public-api-key',
    });
    await fetchAcceptedLocales('en-GB', {
      origin: 'https://18ways.com',
      apiKey: 'test-public-api-key',
    });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not inject an unsupported fallback locale into the accepted-locale list', async () => {
    const locales = await fetchAcceptedLocales('en-US', {
      forceRefresh: true,
      origin: 'https://18ways.com',
      apiKey: 'test-public-api-key',
    });

    expect(locales).toEqual(['en-GB', 'ja-JP']);
  });

  it('falls back to the default locale without fetching when no api key is available', async () => {
    const locales = await fetchAcceptedLocales('en-GB', {
      origin: 'https://18ways.com',
    });

    expect(locales).toEqual(['en-GB']);
    expect(fetch).not.toHaveBeenCalled();
  });
});
