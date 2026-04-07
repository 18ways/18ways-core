import { describe, expect, it, vi } from 'vitest';
import { create18waysEngine } from '../engine';
import type { InProgressTranslation } from '../common';
import { encryptTranslationValue } from '../crypto';
import { formatWaysParser } from '../parsers/ways-parser';

const waitForCondition = async (assertion: () => void, timeoutMs = 1000, intervalMs = 5) => {
  const start = Date.now();
  let lastError: unknown;

  while (Date.now() - start < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  if (lastError) {
    throw lastError;
  }
};

describe('WaysEngine', () => {
  it('returns source text for base locale while still sending a capture request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body || '{}')) as {
        payload?: Array<{
          targetLocale: string;
          key: string;
          textHash: string;
          contextFingerprint?: string | null;
        }>;
      };
      const isKnownRequest = Array.isArray(body.payload) && init?.method === 'POST';
      const responseBody = isKnownRequest ? { data: [], errors: [] } : { data: [], errors: [] };

      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

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
    await waitForCondition(() => {
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('/known');
    expect(fetcher.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
      })
    );
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('/translate');
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
        textHash: entry.textHash,
        translation: encryptTranslationValue({
          translatedText: 'Hola {name}',
          sourceText: entry.text,
          locale: entry.targetLocale,
          key: entry.key,
          textHash: entry.textHash,
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
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('/seed');
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('/translate');
  });

  it('keeps request origins scoped to each engine instance', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const body = JSON.parse(String(init?.body || '{}')) as {
        payload?: Array<{
          targetLocale: string;
          key: string;
          textHash: string;
          contextFingerprint?: string | null;
        }>;
      };

      if (url.pathname.endsWith('/known') && init?.method === 'POST') {
        const firstEntry = Array.isArray(body.payload) ? body.payload[0] : null;
        return new Response(
          JSON.stringify({
            data: firstEntry ? [firstEntry] : [],
            errors: [],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      return new Response(JSON.stringify({ data: [], errors: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const firstEngine = create18waysEngine({
      apiKey: 'test-key',
      apiUrl: 'https://api.18ways.local',
      baseLocale: 'en-US',
      locale: 'en-US',
      context: 'app',
      fetcher,
      origin: 'https://first.18ways.com',
    });

    const secondEngine = create18waysEngine({
      apiKey: 'test-key',
      apiUrl: 'https://api.18ways.local',
      baseLocale: 'en-US',
      locale: 'en-US',
      context: 'app',
      fetcher,
      origin: 'https://second.18ways.com',
    });

    await firstEngine.t('Hello first');
    await firstEngine.getStore().waitForIdle();
    await secondEngine.t('Hello second');
    await secondEngine.getStore().waitForIdle();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          origin: 'https://first.18ways.com',
        }),
      })
    );
    expect(fetcher.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          origin: 'https://second.18ways.com',
        }),
      })
    );
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
            textHash: entry.textHash,
            translation: encryptTranslationValue({
              translatedText: translated,
              sourceText: entry.text,
              locale: entry.targetLocale,
              key: entry.key,
              textHash: entry.textHash,
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
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('/seed');
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('/translate');
  });
});
