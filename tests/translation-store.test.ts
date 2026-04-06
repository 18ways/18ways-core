import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslationStore } from '../translation-store';

const flushAsyncWork = async (passes = 8) => {
  for (let index = 0; index < passes; index += 1) {
    await Promise.resolve();
  }
};

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('TranslationStore', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('garbage-collects translations for contexts that fully unmount when mount-aware GC is enabled', async () => {
    vi.useFakeTimers();

    const store = new TranslationStore({
      baseLocale: 'en-GB',
      locale: 'en-GB',
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
      enableMountAwareGarbageCollection: true,
      mountAwareGarbageCollectionDelayMs: 25,
    });

    store.mount({
      instanceId: 'gc-instance',
      contextKey: 'gc-key',
      textHash: '["Bye","gc-key"]',
      text: 'Bye',
    });
    store.unmount({ instanceId: 'gc-instance' });

    await vi.advanceTimersByTimeAsync(26);

    const translations = store.getState().translations as Record<string, Record<string, unknown>>;
    expect(translations['en-GB']?.['gc-key']).toBeUndefined();
    expect(translations['fr-FR']?.['gc-key']).toBeUndefined();
    expect(translations['en-GB']?.['keep-key']).toEqual({
      '["Hello","keep-key"]': 'Hello',
    });
  });

  it('runs baseLocaleObservation work without marking blocking loading and dedupes by fingerprint', async () => {
    const fetchKnownContext = vi.fn(async () => ({
      data: [],
      errors: [],
    }));
    const fetchKnown = vi.fn(async () => ({
      data: [],
      errors: [],
    }));
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
      baseLocale: 'es-ES',
      locale: 'es-ES',
      translations: {},
      fetchKnownContext,
      fetchKnown,
      fetchTranslations,
    });

    const firstRead = store.getTranslationSync({
      baseLocale: 'es-ES',
      targetLocale: 'es-ES',
      contextKey: 'cta',
      textHash: 'hash_1',
      text: 'Hello',
      contextFingerprint: 'fingerprint-a',
    });

    expect(firstRead).toEqual({
      status: 'ready',
      value: 'Hello',
      fallbackValue: 'Hello',
    });
    expect(store.isLoading()).toBe(false);

    await flushAsyncWork();

    expect(fetchKnownContext).toHaveBeenCalledTimes(1);
    expect(fetchKnown).toHaveBeenCalledTimes(1);
    expect(fetchTranslations).toHaveBeenCalledTimes(1);

    store.getTranslationSync({
      baseLocale: 'es-ES',
      targetLocale: 'es-ES',
      contextKey: 'cta',
      textHash: 'hash_1',
      text: 'Hello',
      contextFingerprint: 'fingerprint-a',
    });
    await flushAsyncWork();

    expect(fetchKnownContext).toHaveBeenCalledTimes(1);
    expect(fetchKnown).toHaveBeenCalledTimes(1);
    expect(fetchTranslations).toHaveBeenCalledTimes(1);

    store.getTranslationSync({
      baseLocale: 'es-ES',
      targetLocale: 'es-ES',
      contextKey: 'cta',
      textHash: 'hash_1',
      text: 'Hello',
      contextFingerprint: 'fingerprint-b',
    });
    await flushAsyncWork();

    expect(fetchKnownContext).toHaveBeenCalledTimes(1);
    expect(fetchKnown).toHaveBeenCalledTimes(2);
    expect(fetchTranslations).toHaveBeenCalledTimes(2);
  });

  it('uses cached known-context snapshots to skip follow-up known checks and translate', async () => {
    const fetchKnownContext = vi.fn(async () => ({
      data: [
        {
          targetLocale: 'es-ES',
          key: 'cta',
          textHash: 'hash_1',
          contextFingerprint: 'fingerprint-a',
        },
        {
          targetLocale: 'es-ES',
          key: 'cta',
          textHash: 'hash_2',
          contextFingerprint: 'fingerprint-b',
        },
      ],
      errors: [],
    }));
    const fetchKnown = vi.fn(async () => ({
      data: [],
      errors: [],
    }));
    const fetchTranslations = vi.fn(async () => ({
      data: [],
      errors: [],
    }));

    const store = new TranslationStore({
      baseLocale: 'es-ES',
      locale: 'es-ES',
      translations: {},
      fetchKnownContext,
      fetchKnown,
      fetchTranslations,
    });

    store.getTranslationSync({
      baseLocale: 'es-ES',
      targetLocale: 'es-ES',
      contextKey: 'cta',
      textHash: 'hash_1',
      text: 'Hello',
      contextFingerprint: 'fingerprint-a',
    });
    store.getTranslationSync({
      baseLocale: 'es-ES',
      targetLocale: 'es-ES',
      contextKey: 'cta',
      textHash: 'hash_2',
      text: 'Goodbye',
      contextFingerprint: 'fingerprint-b',
    });

    await flushAsyncWork();

    expect(fetchKnownContext).toHaveBeenCalledTimes(1);
    expect(fetchKnown).not.toHaveBeenCalled();
    expect(fetchTranslations).not.toHaveBeenCalled();
  });

  it('dehydrates translations and config into a hydrate-compatible payload', () => {
    const store = new TranslationStore({
      baseLocale: 'en-GB',
      locale: 'fr-FR',
      translations: {
        'fr-FR': {
          cta: {
            hash_1: 'Bonjour',
          },
        },
      },
      acceptedLocales: ['en-GB', 'fr-FR'],
      translationFallback: {
        default: 'blank',
        overrides: [{ locale: 'fr-FR', fallback: 'source' }],
      },
      fetchTranslations: vi.fn(async () => ({ data: [], errors: [] })),
    });

    expect(store.dehydrate()).toEqual({
      translations: {
        'fr-FR': {
          cta: {
            hash_1: 'Bonjour',
          },
        },
      },
      config: {
        acceptedLocales: ['en-GB', 'fr-FR'],
        translationFallback: {
          default: 'blank',
          overrides: [{ locale: 'fr-FR', fallback: 'source' }],
        },
      },
    });
  });

  it('falls back to POST known/translate for baseLocaleObservation entries missing from the cached context snapshot', async () => {
    const fetchKnownContext = vi.fn(async () => ({
      data: [
        {
          targetLocale: 'es-ES',
          key: 'cta',
          textHash: 'hash_1',
          contextFingerprint: 'fingerprint-a',
        },
      ],
      errors: [],
    }));
    const fetchKnown = vi.fn(async () => ({
      data: [],
      errors: [],
    }));
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
      baseLocale: 'es-ES',
      locale: 'es-ES',
      translations: {},
      fetchKnownContext,
      fetchKnown,
      fetchTranslations,
    });

    store.getTranslationSync({
      baseLocale: 'es-ES',
      targetLocale: 'es-ES',
      contextKey: 'cta',
      textHash: 'hash_1',
      text: 'Hello',
      contextFingerprint: 'fingerprint-a',
    });
    store.getTranslationSync({
      baseLocale: 'es-ES',
      targetLocale: 'es-ES',
      contextKey: 'cta',
      textHash: 'hash_2',
      text: 'Goodbye',
      contextFingerprint: 'fingerprint-b',
    });

    await flushAsyncWork();

    expect(fetchKnownContext).toHaveBeenCalledTimes(1);
    expect(fetchKnown).toHaveBeenCalledTimes(1);
    expect(fetchTranslations).toHaveBeenCalledTimes(1);
    expect(fetchTranslations).toHaveBeenCalledWith([
      expect.objectContaining({
        targetLocale: 'es-ES',
        key: 'cta',
        textHash: 'hash_2',
        contextFingerprint: 'fingerprint-b',
      }),
    ]);
  });

  it('clears remembered baseLocaleObservation state when mount-aware GC prunes a context', async () => {
    vi.useFakeTimers();

    const fetchKnownContext = vi.fn(async () => ({
      data: [],
      errors: [],
    }));
    const fetchKnown = vi.fn(async () => ({
      data: [],
      errors: [],
    }));
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
      baseLocale: 'es-ES',
      locale: 'es-ES',
      translations: {},
      fetchKnownContext,
      fetchKnown,
      fetchTranslations,
      enableMountAwareGarbageCollection: true,
      mountAwareGarbageCollectionDelayMs: 25,
    });

    store.mount({
      instanceId: 'cta-instance',
      contextKey: 'cta',
      textHash: 'hash_1',
      text: 'Hello',
      baseLocale: 'es-ES',
      targetLocale: 'es-ES',
      contextFingerprint: 'fingerprint-a',
    });
    store.getTranslationSync({
      baseLocale: 'es-ES',
      targetLocale: 'es-ES',
      contextKey: 'cta',
      textHash: 'hash_1',
      text: 'Hello',
      contextFingerprint: 'fingerprint-a',
    });

    await flushAsyncWork();
    expect(fetchKnown).toHaveBeenCalledTimes(1);

    store.unmount({ instanceId: 'cta-instance' });
    await vi.advanceTimersByTimeAsync(26);

    store.mount({
      instanceId: 'cta-instance-next',
      contextKey: 'cta',
      textHash: 'hash_1',
      text: 'Hello',
      baseLocale: 'es-ES',
      targetLocale: 'es-ES',
      contextFingerprint: 'fingerprint-a',
    });
    store.getTranslationSync({
      baseLocale: 'es-ES',
      targetLocale: 'es-ES',
      contextKey: 'cta',
      textHash: 'hash_1',
      text: 'Hello',
      contextFingerprint: 'fingerprint-a',
    });

    await flushAsyncWork();

    expect(fetchKnown).toHaveBeenCalledTimes(2);
  });

  it('error-caches fingerprinted translate requests when the backend only acknowledges the triple', async () => {
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
      baseLocale: 'en-GB',
      locale: 'es-ES',
      translations: {},
      fetchTranslations,
    });

    const firstRead = store.getTranslationSync({
      targetLocale: 'es-ES',
      contextKey: 'cta',
      textHash: 'hash_1',
      text: 'Hello',
      contextFingerprint: 'fingerprint-a',
    });
    expect(firstRead.status).toBe('pending');

    await store.waitForIdle();
    expect(fetchTranslations).toHaveBeenCalledTimes(1);

    const secondRead = store.getTranslationSync({
      targetLocale: 'es-ES',
      contextKey: 'cta',
      textHash: 'hash_1',
      text: 'Hello',
      contextFingerprint: 'fingerprint-a',
    });
    expect(secondRead.status).toBe('ready');

    await store.waitForIdle();
    expect(fetchTranslations).toHaveBeenCalledTimes(1);
  });

  it('resets timeout-aware idle windows after blocking work settles', async () => {
    vi.useFakeTimers();

    const firstDeferred = createDeferred<any>();
    const secondDeferred = createDeferred<any>();
    const fetchTranslations = vi
      .fn()
      .mockReturnValueOnce(firstDeferred.promise)
      .mockReturnValueOnce(secondDeferred.promise);

    const store = new TranslationStore({
      baseLocale: 'en-GB',
      locale: 'es-ES',
      translations: {},
      fetchTranslations,
    });

    const firstRead = store.getTranslationSync({
      targetLocale: 'es-ES',
      contextKey: 'home',
      textHash: 'hash_home',
      text: 'Home',
    });
    expect(firstRead.status).toBe('pending');

    const firstIdleState = store.getIdleState({ timeoutMs: 25 });
    expect(firstIdleState.timedOut).toBe(false);
    expect(firstIdleState.promise).not.toBeNull();

    await vi.advanceTimersByTimeAsync(26);

    const expiredIdleState = store.getIdleState({ timeoutMs: 25 });
    expect(expiredIdleState.timedOut).toBe(true);
    expect(expiredIdleState.promise).toBe(firstIdleState.promise);

    firstDeferred.resolve({
      data: [
        {
          locale: 'es-ES',
          key: 'home',
          textHash: 'hash_home',
          translation: 'Inicio',
        },
      ],
      errors: [],
    });
    await firstDeferred.promise;
    await store.waitForIdle();

    expect(store.getIdleState({ timeoutMs: 25 })).toEqual({
      timedOut: false,
      promise: null,
    });

    const secondRead = store.getTranslationSync({
      targetLocale: 'es-ES',
      contextKey: 'about',
      textHash: 'hash_about',
      text: 'About',
    });
    expect(secondRead.status).toBe('pending');

    const secondIdleState = store.getIdleState({ timeoutMs: 25 });
    expect(secondIdleState.timedOut).toBe(false);
    expect(secondIdleState.promise).not.toBeNull();
    expect(secondIdleState.promise).not.toBe(firstIdleState.promise);
  });
});
