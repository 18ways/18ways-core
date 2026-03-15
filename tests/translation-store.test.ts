import { describe, expect, it, vi } from 'vitest';
import { TranslationStore } from '../translation-store';

describe('TranslationStore', () => {
  it('deletes all locale entries for an unmounted context key', () => {
    const store = new TranslationStore({
      translations: {
        'en-GB': {
          'keep-key': {
            '["Hello","keep-key"]': ['Hello'],
          },
          'gc-key': {
            '["Bye","gc-key"]': ['Bye'],
          },
        },
        'fr-FR': {
          'gc-key': {
            '["Bye","gc-key"]': ['Au revoir'],
          },
        },
      },
      fetchTranslations: vi.fn(async () => ({ data: [], errors: [] })),
    });

    store.deleteContextTranslations('gc-key');

    expect(store.getTranslation('en-GB', 'gc-key', '["Bye","gc-key"]')).toBeUndefined();
    expect(store.getTranslation('fr-FR', 'gc-key', '["Bye","gc-key"]')).toBeUndefined();
    expect(store.getTranslation('en-GB', 'keep-key', '["Hello","keep-key"]')).toEqual(['Hello']);
  });

  it('syncs cached translations once per context fingerprint without entering loading state', async () => {
    const fetchTranslations = vi.fn(async (entries) => ({
      data: entries.map((entry) => ({
        locale: entry.targetLocale,
        key: entry.key,
        textsHash: entry.textsHash,
        contextFingerprint: entry.contextFingerprint ?? null,
        translationId: 'group-1',
        translation: ['Hola'],
      })),
      errors: [],
    }));
    const store = new TranslationStore({
      translations: {
        'es-ES': {
          cta: {
            hash_1: ['Hola'],
          },
        },
      },
      fetchTranslations,
    });

    expect(
      store.enqueue({
        targetLocale: 'es-ES',
        key: 'cta',
        textsHash: 'hash_1',
        texts: ['Hello'],
        contextFingerprint: 'fingerprint-a',
        syncOnly: true,
      })
    ).toBe(true);
    expect(store.getSnapshot().hasPending).toBe(false);

    await store.waitForIdle();

    expect(fetchTranslations).toHaveBeenCalledTimes(1);
    expect(
      store.hasCompletedEntry({
        targetLocale: 'es-ES',
        key: 'cta',
        textsHash: 'hash_1',
        contextFingerprint: 'fingerprint-a',
      })
    ).toBe(true);
    expect(
      store.enqueue({
        targetLocale: 'es-ES',
        key: 'cta',
        textsHash: 'hash_1',
        texts: ['Hello'],
        contextFingerprint: 'fingerprint-a',
        syncOnly: true,
      })
    ).toBe(false);
    expect(
      store.enqueue({
        targetLocale: 'es-ES',
        key: 'cta',
        textsHash: 'hash_1',
        texts: ['Hello'],
        contextFingerprint: 'fingerprint-b',
        syncOnly: true,
      })
    ).toBe(true);

    await store.waitForIdle();

    expect(fetchTranslations).toHaveBeenCalledTimes(2);
  });

  it('clears completed sync entries when a context is garbage-collected', async () => {
    const fetchTranslations = vi.fn(async (entries) => ({
      data: entries.map((entry) => ({
        locale: entry.targetLocale,
        key: entry.key,
        textsHash: entry.textsHash,
        contextFingerprint: entry.contextFingerprint ?? null,
        translationId: 'group-1',
        translation: ['Hola'],
      })),
      errors: [],
    }));
    const store = new TranslationStore({
      translations: {
        'es-ES': {
          cta: {
            hash_1: ['Hola'],
          },
        },
      },
      fetchTranslations,
    });

    store.enqueue({
      targetLocale: 'es-ES',
      key: 'cta',
      textsHash: 'hash_1',
      texts: ['Hello'],
      contextFingerprint: 'fingerprint-a',
      syncOnly: true,
    });
    await store.waitForIdle();

    store.deleteContextTranslations('cta');

    expect(
      store.enqueue({
        targetLocale: 'es-ES',
        key: 'cta',
        textsHash: 'hash_1',
        texts: ['Hello'],
        contextFingerprint: 'fingerprint-a',
        syncOnly: true,
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
          textsHash: 'hash_1',
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
        textsHash: 'hash_1',
        texts: ['Hello'],
        contextFingerprint: 'fingerprint-a',
      })
    ).toBe(true);

    await store.waitForIdle();

    expect(fetchTranslations).toHaveBeenCalledTimes(1);
    expect(
      store.enqueue({
        targetLocale: 'es-ES',
        key: 'cta',
        textsHash: 'hash_1',
        texts: ['Hello'],
        contextFingerprint: 'fingerprint-a',
      })
    ).toBe(false);

    consoleWarnSpy.mockRestore();
  });
});
