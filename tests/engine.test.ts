import { describe, expect, it, vi } from 'vitest';
import { create18waysEngine } from '../engine';
import type { InProgressTranslation } from '../common';
import { encryptTranslationValues } from '../crypto';

describe('WaysEngine', () => {
  it('returns source text for base locale without calling translate endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [], errors: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const engine = create18waysEngine({
      apiKey: 'test-key',
      apiUrl: 'https://api.18ways.local',
      baseLocale: 'en-US',
      locale: 'en-US',
      context: 'app',
      fetcher,
    });

    const value = await engine.t('Hello world');
    expect(value).toBe('Hello world');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fetches, decrypts, and caches translated values by locale', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const payload = JSON.parse(String(init?.body || '{}')) as {
        payload: InProgressTranslation[];
      };
      const entries = Array.isArray(payload.payload) ? payload.payload : [];

      const data = entries.map((entry) => ({
        locale: entry.targetLocale,
        key: entry.key,
        textsHash: entry.textsHash,
        translation: encryptTranslationValues({
          translatedTexts: ['Hola {name}'],
          sourceTexts: entry.texts,
          locale: entry.targetLocale,
          key: entry.key,
          textsHash: entry.textsHash,
        }),
      }));

      return new Response(JSON.stringify({ data, errors: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const engine = create18waysEngine({
      apiKey: 'test-key',
      apiUrl: 'https://api.18ways.local',
      baseLocale: 'en-US',
      locale: 'es-ES',
      context: 'app',
      fetcher,
    });

    const first = await engine.t('Hello {name}', { vars: { name: 'Ada' } });
    const second = await engine.t('Hello {name}', { vars: { name: 'Ada' } });

    expect(first).toBe('Hola Ada');
    expect(second).toBe('Hola Ada');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
