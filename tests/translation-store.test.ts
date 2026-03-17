import { describe, expect, it, vi } from 'vitest';
import { TranslationStore } from '../translation-store';

describe('TranslationStore', () => {
  it('deletes all locale entries for an unmounted context key', () => {
    const store = new TranslationStore({
      translations: {
        'en-GB': {
          'keep-key': {
            '["Hello","keep-key"]': 'Hello',
          },
          'gc-key': {
            '["Bye","gc-key"]': 'Bye',
          },
        },
        'fr-FR': {
          'gc-key': {
            '["Bye","gc-key"]': 'Au revoir',
          },
        },
      },
      fetchTranslations: vi.fn(async () => ({ data: [], errors: [] })),
    });

    store.deleteContextTranslations('gc-key');

    expect(store.getTranslation('en-GB', 'gc-key', '["Bye","gc-key"]')).toBeUndefined();
    expect(store.getTranslation('fr-FR', 'gc-key', '["Bye","gc-key"]')).toBeUndefined();
    expect(store.getTranslation('en-GB', 'keep-key', '["Hello","keep-key"]')).toEqual('Hello');
  });

  it('captures same-locale observations once per context fingerprint without entering loading state', async () => {
    const fetchTranslations = vi.fn(async (entries) => ({
      data: entries.map((entry) => ({
        locale: entry.targetLocale,
        key: entry.key,
        textHash: entry.textHash,
        contextFingerprint: entry.contextFingerprint ?? null,
        translationId: 'group-1',
        translation: 'Hola',
      })),
      errors: [],
    }));
    const store = new TranslationStore({
      translations: {
        'es-ES': {
          cta: {
            hash_1: 'Hola',
          },
        },
      },
      fetchTranslations,
    });

    expect(
      store.enqueue({
        baseLocale: 'es-ES',
        targetLocale: 'es-ES',
        key: 'cta',
        textHash: 'hash_1',
        text: 'Hello',
        contextFingerprint: 'fingerprint-a',
      })
    ).toBe(true);
    expect(store.getSnapshot().hasPending).toBe(false);

    await store.waitForIdle();

    expect(fetchTranslations).toHaveBeenCalledTimes(1);
    expect(
      store.hasCompletedEntry({
        targetLocale: 'es-ES',
        key: 'cta',
        textHash: 'hash_1',
        contextFingerprint: 'fingerprint-a',
      })
    ).toBe(true);
    expect(
      store.enqueue({
        baseLocale: 'es-ES',
        targetLocale: 'es-ES',
        key: 'cta',
        textHash: 'hash_1',
        text: 'Hello',
        contextFingerprint: 'fingerprint-a',
      })
    ).toBe(false);
    expect(
      store.enqueue({
        baseLocale: 'es-ES',
        targetLocale: 'es-ES',
        key: 'cta',
        textHash: 'hash_1',
        text: 'Hello',
        contextFingerprint: 'fingerprint-b',
      })
    ).toBe(true);

    await store.waitForIdle();

    expect(fetchTranslations).toHaveBeenCalledTimes(2);
  });

  it('clears completed capture entries when a context is garbage-collected', async () => {
    const fetchTranslations = vi.fn(async (entries) => ({
      data: entries.map((entry) => ({
        locale: entry.targetLocale,
        key: entry.key,
        textHash: entry.textHash,
        contextFingerprint: entry.contextFingerprint ?? null,
        translationId: 'group-1',
        translation: 'Hola',
      })),
      errors: [],
    }));
    const store = new TranslationStore({
      translations: {
        'es-ES': {
          cta: {
            hash_1: 'Hola',
          },
        },
      },
      fetchTranslations,
    });

    store.enqueue({
      baseLocale: 'es-ES',
      targetLocale: 'es-ES',
      key: 'cta',
      textHash: 'hash_1',
      text: 'Hello',
      contextFingerprint: 'fingerprint-a',
    });
    await store.waitForIdle();

    store.deleteContextTranslations('cta');

    expect(
      store.enqueue({
        baseLocale: 'es-ES',
        targetLocale: 'es-ES',
        key: 'cta',
        textHash: 'hash_1',
        text: 'Hello',
        contextFingerprint: 'fingerprint-a',
      })
    ).toBe(true);
  });

  it('error-caches fingerprinted requests when the backend only acknowledges the triple', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchTranslations = vi.fn(async () => ({
      data: [],
      errors: [
        {
          locale: 'es-ES',
          key: 'cta',
          textHash: 'hash_1',
        },
      ],
    }));
    const store = new TranslationStore({
      translations: {},
      fetchTranslations,
    });

    expect(
      store.enqueue({
        targetLocale: 'es-ES',
        key: 'cta',
        textHash: 'hash_1',
        text: 'Hello',
        contextFingerprint: 'fingerprint-a',
      })
    ).toBe(true);

    await store.waitForIdle();

    expect(fetchTranslations).toHaveBeenCalledTimes(1);
    expect(
      store.enqueue({
        targetLocale: 'es-ES',
        key: 'cta',
        textHash: 'hash_1',
        text: 'Hello',
        contextFingerprint: 'fingerprint-a',
      })
    ).toBe(false);

    consoleWarnSpy.mockRestore();
  });
});
