import { describe, expect, it, vi } from 'vitest';
import { create18waysEngine } from '../engine';
import type { InProgressTranslation } from '../common';
import { encryptTranslationValues } from '../crypto';
import { formatWaysParser } from '../parsers/ways-parser';

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

  it('formats runtime-only waysParser messages locally without calling translate', async () => {
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
      locale: 'es-ES',
      context: 'app',
      fetcher,
    });

    const source = '{createdAt, date, dateStyle:short}';
    const vars = { createdAt: new Date(Date.UTC(2024, 0, 15, 12)) };

    const value = await engine.t(source, { vars });

    expect(value).toBe(formatWaysParser(vars, source, 'es-ES'));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('formats bare date placeholders locally without calling translate', async () => {
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
      locale: 'es-ES',
      context: 'app',
      fetcher,
    });

    const source = '{myDate}';
    const vars = { myDate: new Date(Date.UTC(2024, 0, 15, 12)) };

    const value = await engine.t(source, { vars });

    expect(value).toBe(formatWaysParser(vars, source, 'es-ES'));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('still fetches translations for plural messages with literal branch text', async () => {
    const source = '{count, plural, =0{No messages} other{{count} messages}}';
    const translated = '{count, plural, =0{No hay mensajes} other{{count} mensajes}}';
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const payload = JSON.parse(String(init?.body || '{}')) as {
        payload: InProgressTranslation[];
      };
      const entries = Array.isArray(payload.payload) ? payload.payload : [];

      return new Response(
        JSON.stringify({
          data: entries.map((entry) => ({
            locale: entry.targetLocale,
            key: entry.key,
            textsHash: entry.textsHash,
            translation: encryptTranslationValues({
              translatedTexts: [translated],
              sourceTexts: entry.texts,
              locale: entry.targetLocale,
              key: entry.key,
              textsHash: entry.textsHash,
            }),
          })),
          errors: [],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const engine = create18waysEngine({
      apiKey: 'test-key',
      apiUrl: 'https://api.18ways.local',
      baseLocale: 'en-US',
      locale: 'es-ES',
      context: 'app',
      fetcher,
    });

    const value = await engine.t(source, { vars: { count: 2 } });

    expect(value).toBe('2 mensajes');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
