import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAcceptedLocales } from '../i18n-shared';

describe('fetchAcceptedLocales origin handling', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          languages: [{ code: 'en-GB' }, { code: 'ja-JP' }],
        }),
      })
    );
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

  it('uses explicit apiKey option when env key is unavailable', async () => {
    await fetchAcceptedLocales('en-GB', {
      forceRefresh: true,
      origin: 'https://18ways.com',
      apiKey: 'api-key-from-ways-props',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'x-api-key': 'api-key-from-ways-props',
          origin: 'https://18ways.com',
        }),
      })
    );
  });

  it('keeps accepted locale cache scoped by origin', async () => {
    await fetchAcceptedLocales('en-GB', {
      forceRefresh: true,
      origin: 'https://18ways.com',
      apiKey: 'first-key',
    });
    await fetchAcceptedLocales('en-GB', {
      origin: 'https://preview.18ways.com',
      apiKey: 'first-key',
    });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not reuse no-key cache for keyed requests on the same origin', async () => {
    await fetchAcceptedLocales('en-GB', {
      forceRefresh: true,
      origin: 'https://18ways.com',
    });

    await fetchAcceptedLocales('en-GB', {
      origin: 'https://18ways.com',
      apiKey: 'org-specific-key',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'x-api-key': 'org-specific-key',
          origin: 'https://18ways.com',
        }),
      })
    );
  });
});
