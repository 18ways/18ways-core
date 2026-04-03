import set from 'set-value';
import type {
  FetchKnownContextResult,
  FetchKnownResult,
  FetchTranslationsResult,
  InProgressTranslation,
  KnownTranslationEntry,
  Translations,
} from './common';
import { normalizeTranslationContextFingerprint } from './context-fingerprint';
import { deepMerge, getPath } from './object-utils';

export interface TranslationStoreSnapshot {
  version: number;
  translations: Translations;
  hasPending: boolean;
  hasInFlight: boolean;
}

export interface TranslationDataSnapshot {
  version: number;
  translations: Translations;
}

type FetchTranslationsFn = (
  toTranslate: InProgressTranslation[]
) => Promise<FetchTranslationsResult | undefined>;

type FetchKnownFn = (entries: KnownTranslationEntry[]) => Promise<FetchKnownResult | undefined>;

type FetchKnownContextFn = (input: {
  targetLocale: string;
  key: string;
}) => Promise<FetchKnownContextResult | undefined>;

const ERROR_CACHE_TTL_MS = 1000 * 60;

const translationEntryTriple = (
  entry: Pick<InProgressTranslation, 'targetLocale' | 'key' | 'textHash'>
) => JSON.stringify([entry.targetLocale, entry.key, entry.textHash]);

const isCaptureEntry = (
  entry: Pick<InProgressTranslation, 'baseLocale' | 'targetLocale'>
): boolean => {
  return Boolean(entry.baseLocale && entry.targetLocale && entry.baseLocale === entry.targetLocale);
};

export const translationEntryId = (
  entry: Pick<InProgressTranslation, 'targetLocale' | 'key' | 'textHash' | 'contextFingerprint'>
) =>
  JSON.stringify([
    entry.targetLocale,
    entry.key,
    entry.textHash,
    normalizeTranslationContextFingerprint(entry.contextFingerprint),
  ]);

const entryMatchesContextKey = (entryId: string, contextKey: string): boolean => {
  try {
    const parsed = JSON.parse(entryId);
    return Array.isArray(parsed) && parsed[1] === contextKey;
  } catch {
    return false;
  }
};

export class TranslationStore {
  private translations: Translations;
  private fetchTranslations: FetchTranslationsFn;
  private fetchKnown?: FetchKnownFn;
  private fetchKnownContext?: FetchKnownContextFn;
  private listeners = new Set<() => void>();
  private translationListeners = new Set<() => void>();
  private pending = new Map<string, InProgressTranslation>();
  private inFlight = new Set<string>();
  private completed = new Set<string>();
  private knownContextEntries = new Map<string, Set<string>>();
  private knownContextLoads = new Map<string, Promise<Set<string> | null>>();
  private pendingByKey = new Map<string, number>();
  private inFlightByKey = new Map<string, number>();
  private errorCache = new Map<string, number>();
  private flushPromise: Promise<void> | null = null;
  private flushScheduled = false;
  private version = 0;
  private snapshot: TranslationStoreSnapshot;
  private translationSnapshot: TranslationDataSnapshot;

  constructor(options: {
    translations: Translations;
    fetchTranslations: FetchTranslationsFn;
    fetchKnown?: FetchKnownFn;
    fetchKnownContext?: FetchKnownContextFn;
  }) {
    this.translations = options.translations;
    this.fetchTranslations = options.fetchTranslations;
    this.fetchKnown = options.fetchKnown;
    this.fetchKnownContext = options.fetchKnownContext;
    this.translationSnapshot = {
      version: this.version,
      translations: this.translations,
    };
    this.snapshot = {
      version: this.version,
      translations: this.translations,
      hasPending: false,
      hasInFlight: false,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  subscribeToTranslations = (listener: () => void): (() => void) => {
    this.translationListeners.add(listener);
    return () => {
      this.translationListeners.delete(listener);
    };
  };

  getSnapshot = (): TranslationStoreSnapshot => {
    return this.snapshot;
  };

  getTranslationsSnapshot = (): TranslationDataSnapshot => {
    return this.translationSnapshot;
  };

  hasInFlightRequests = (): boolean => this.inFlightByKey.size > 0;

  hasPendingRequests = (): boolean => this.pendingByKey.size > 0;

  hasInFlightEntries = (): boolean => this.inFlight.size > 0;

  hasPendingEntries = (): boolean => this.pending.size > 0;

  hasInFlightRequestsForKey = (key: string): boolean => (this.inFlightByKey.get(key) ?? 0) > 0;

  hasPendingRequestsForKey = (key: string): boolean => (this.pendingByKey.get(key) ?? 0) > 0;

  getTranslation = (locale: string, key: string, textHash: string): string | undefined => {
    return getPath(this.translations, [locale, key, textHash]) as string | undefined;
  };

  isInFlight = (id: string): boolean => this.inFlight.has(id);

  hasCompletedEntry = (
    entry: Pick<InProgressTranslation, 'targetLocale' | 'key' | 'textHash' | 'contextFingerprint'>
  ): boolean => this.completed.has(translationEntryId(entry));

  isErrorCached = (id: string): boolean => {
    const expiry = this.errorCache.get(id);
    return typeof expiry === 'number' && Date.now() < expiry;
  };

  prime = (translations: Translations): void => {
    if (!translations || typeof translations !== 'object') {
      return;
    }
    deepMerge(this.translations, translations);
    this.emit(true);
  };

  setCompletedTranslation = (keyPath: string[], translation: string): void => {
    set(this.translations, keyPath, translation);
    this.emit(true);
  };

  deleteContextTranslations = (contextKey: string): void => {
    if (!contextKey) {
      return;
    }

    let changed = false;
    Object.keys(this.translations).forEach((locale) => {
      const localeTranslations = this.translations[locale] as Record<string, unknown> | undefined;
      if (!localeTranslations || typeof localeTranslations !== 'object') {
        return;
      }

      if (!(contextKey in localeTranslations)) {
        return;
      }

      delete (localeTranslations as Record<string, unknown>)[contextKey];
      changed = true;

      if (!Object.keys(localeTranslations).length) {
        delete (this.translations as Record<string, unknown>)[locale];
      }
    });

    Array.from(this.completed).forEach((entryId) => {
      if (entryMatchesContextKey(entryId, contextKey)) {
        this.completed.delete(entryId);
      }
    });

    Array.from(this.errorCache.keys()).forEach((entryId) => {
      if (entryMatchesContextKey(entryId, contextKey)) {
        this.errorCache.delete(entryId);
      }
    });

    Array.from(this.knownContextEntries.keys()).forEach((cacheKey) => {
      if (this.getContextKeyFromKnownContextCacheKey(cacheKey) === contextKey) {
        this.knownContextEntries.delete(cacheKey);
        this.knownContextLoads.delete(cacheKey);
      }
    });

    if (changed) {
      this.emit(true);
    }
  };

  enqueue = (entry: InProgressTranslation): boolean => {
    const id = translationEntryId(entry);
    const captureEntry = isCaptureEntry(entry);

    if (!entry.targetLocale) {
      return false;
    }

    const hasCachedTranslation = Boolean(
      this.getTranslation(entry.targetLocale, entry.key, entry.textHash)
    );

    if (!captureEntry && hasCachedTranslation) {
      return false;
    }

    if (captureEntry && this.completed.has(id)) {
      return false;
    }

    if (this.pending.has(id) || this.inFlight.has(id) || this.isErrorCached(id)) {
      return false;
    }

    this.pending.set(id, entry);
    if (!captureEntry) {
      this.adjustContextCount(this.pendingByKey, entry.key, 1);
    }
    this.scheduleFlush();
    return true;
  };

  ensure = async (entries: InProgressTranslation[]): Promise<void> => {
    entries.forEach((entry) => {
      this.enqueue(entry);
    });

    if (!this.pending.size) {
      if (this.flushPromise) {
        await this.flushPromise;
      }
      return;
    }

    await this.flush();
  };

  waitForIdle = async (): Promise<void> => {
    while (this.pending.size || this.inFlight.size || this.flushPromise) {
      if (this.pending.size) {
        await this.flush();
        continue;
      }

      if (this.flushPromise) {
        await this.flushPromise;
        continue;
      }

      await Promise.resolve();
    }
  };

  waitForBlockingIdle = async (): Promise<void> => {
    while (this.pendingByKey.size || this.inFlightByKey.size) {
      if (this.pendingByKey.size) {
        await this.flush();
        continue;
      }

      await Promise.resolve();
    }
  };

  waitForIdleForKey = async (key: string): Promise<void> => {
    while (this.hasPendingRequestsForKey(key) || this.hasInFlightRequestsForKey(key)) {
      if (this.hasPendingRequestsForKey(key)) {
        await this.flush();
        continue;
      }

      if (this.flushPromise) {
        await this.flushPromise;
        continue;
      }

      await Promise.resolve();
    }
  };

  private scheduleFlush = (): void => {
    if (this.flushScheduled) {
      return;
    }

    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.flush().catch((error) => {
        console.error('Unexpected error while processing translation queue:', error);
      });
    });
  };

  private flush = async (): Promise<void> => {
    if (this.flushPromise) {
      await this.flushPromise;
      return;
    }

    this.flushPromise = this.drainPendingQueue().finally(() => {
      this.flushPromise = null;
      this.emit(false);
    });

    await this.flushPromise;
  };

  private drainPendingQueue = async (): Promise<void> => {
    while (this.pending.size) {
      const batch = Array.from(this.pending.values());
      this.pending.clear();

      batch.forEach((entry) => {
        if (!isCaptureEntry(entry)) {
          this.adjustContextCount(this.pendingByKey, entry.key, -1);
        }
        this.inFlight.add(translationEntryId(entry));
        if (!isCaptureEntry(entry)) {
          this.adjustContextCount(this.inFlightByKey, entry.key, 1);
        }
      });
      this.emit(false);

      try {
        const captureEntries = batch.filter((entry) => isCaptureEntry(entry));
        const regularEntries = batch.filter((entry) => !isCaptureEntry(entry));
        const knownCaptureEntryIds = new Set<string>();
        const unknownCaptureEntries: InProgressTranslation[] = [];

        if (captureEntries.length) {
          const captureEntriesByContext = new Map<string, InProgressTranslation[]>();
          captureEntries.forEach((entry) => {
            const cacheKey = this.buildKnownContextCacheKey(entry.targetLocale, entry.key);
            const existingEntries = captureEntriesByContext.get(cacheKey);
            if (existingEntries) {
              existingEntries.push(entry);
              return;
            }
            captureEntriesByContext.set(cacheKey, [entry]);
          });

          for (const [cacheKey, contextEntries] of captureEntriesByContext.entries()) {
            const firstEntry = contextEntries[0];
            const knownContextEntries = await this.ensureKnownContextEntries({
              targetLocale: firstEntry.targetLocale,
              key: firstEntry.key,
            });

            if (!knownContextEntries) {
              unknownCaptureEntries.push(...contextEntries);
              continue;
            }

            contextEntries.forEach((entry) => {
              const id = translationEntryId(entry);
              if (knownContextEntries.has(id)) {
                knownCaptureEntryIds.add(id);
                this.completed.add(id);
                return;
              }

              unknownCaptureEntries.push(entry);
            });
            this.knownContextEntries.set(cacheKey, knownContextEntries);
          }
        }

        if (unknownCaptureEntries.length && this.fetchKnown) {
          const knownResult = await this.fetchKnown(
            unknownCaptureEntries.map((entry) => ({
              targetLocale: entry.targetLocale,
              key: entry.key,
              textHash: entry.textHash,
              contextFingerprint: entry.contextFingerprint ?? null,
            }))
          );

          if (knownResult && Array.isArray(knownResult.data)) {
            this.rememberKnownEntries(knownResult.data);
            knownResult.data.forEach((entry) => {
              const id = translationEntryId({
                targetLocale: entry.targetLocale,
                key: entry.key,
                textHash: entry.textHash,
                contextFingerprint: entry.contextFingerprint ?? undefined,
              });
              knownCaptureEntryIds.add(id);
              this.completed.add(id);
            });
          }
        }

        const fetchBatch = [
          ...regularEntries,
          ...unknownCaptureEntries.filter(
            (entry) => !knownCaptureEntryIds.has(translationEntryId(entry))
          ),
        ];
        if (fetchBatch.length) {
          const result = await this.fetchTranslations(fetchBatch);
          if (!result || !Array.isArray(result.data) || !Array.isArray(result.errors)) {
            throw new Error('Invalid translation response');
          }

          const successfulRequestIds = new Set<string>();
          const successfulRequestTriples = new Set<string>();

          result.data.forEach(({ locale, key, textHash, translation, contextFingerprint }) => {
            set(this.translations, [locale, key, textHash], translation);
            successfulRequestTriples.add(
              translationEntryTriple({
                targetLocale: locale,
                key,
                textHash,
              })
            );
            successfulRequestIds.add(
              translationEntryId({
                targetLocale: locale,
                key,
                textHash,
                contextFingerprint: contextFingerprint ?? undefined,
              })
            );
          });

          result.errors.forEach(({ locale, key, textHash, contextFingerprint }) => {
            const id = translationEntryId({
              targetLocale: locale,
              key,
              textHash,
              contextFingerprint: contextFingerprint ?? undefined,
            });
            this.errorCache.set(id, Date.now() + ERROR_CACHE_TTL_MS);
          });

          // If the backend does not acknowledge a requested entry at all, treat it
          // as a temporary error to avoid infinite retry loops.
          fetchBatch.forEach((entry) => {
            const id = translationEntryId(entry);
            const triple = translationEntryTriple(entry);
            if (successfulRequestIds.has(id) || successfulRequestTriples.has(triple)) {
              this.completed.add(id);
              if (isCaptureEntry(entry)) {
                this.rememberKnownEntries([
                  {
                    targetLocale: entry.targetLocale,
                    key: entry.key,
                    textHash: entry.textHash,
                    contextFingerprint: entry.contextFingerprint ?? null,
                  },
                ]);
              }
              return;
            }

            this.errorCache.set(id, Date.now() + ERROR_CACHE_TTL_MS);
          });

          if (result.errors.length) {
            console.warn('Some translations failed');
          }

          if (result.data.length) {
            this.emit(true);
          }
        }
      } catch (error) {
        console.error('Unexpected error while fetching translations:', error);
        batch.forEach((entry) => {
          this.errorCache.set(translationEntryId(entry), Date.now() + ERROR_CACHE_TTL_MS);
        });
      } finally {
        batch.forEach((entry) => {
          this.inFlight.delete(translationEntryId(entry));
          if (!isCaptureEntry(entry)) {
            this.adjustContextCount(this.inFlightByKey, entry.key, -1);
          }
        });
        this.emit(false);
      }
    }
  };

  private adjustContextCount = (bucket: Map<string, number>, key: string, delta: number): void => {
    const nextVal = (bucket.get(key) ?? 0) + delta;
    if (nextVal <= 0) {
      bucket.delete(key);
      return;
    }
    bucket.set(key, nextVal);
  };

  private emit = (translationsChanged: boolean): void => {
    if (translationsChanged) {
      this.version += 1;
      this.translationSnapshot = {
        version: this.version,
        translations: this.translations,
      };
    }

    this.snapshot = {
      version: this.version,
      translations: this.translations,
      hasPending: this.pendingByKey.size > 0,
      hasInFlight: this.inFlightByKey.size > 0,
    };

    this.listeners.forEach((listener) => listener());
    if (translationsChanged) {
      this.translationListeners.forEach((listener) => listener());
    }
  };

  private buildKnownContextCacheKey = (targetLocale: string, key: string): string =>
    JSON.stringify([targetLocale, key]);

  private getContextKeyFromKnownContextCacheKey = (cacheKey: string): string | null => {
    try {
      const parsed = JSON.parse(cacheKey);
      return Array.isArray(parsed) && typeof parsed[1] === 'string' ? parsed[1] : null;
    } catch {
      return null;
    }
  };

  private rememberKnownEntries = (entries: KnownTranslationEntry[]): void => {
    entries.forEach((entry) => {
      const cacheKey = this.buildKnownContextCacheKey(entry.targetLocale, entry.key);
      const existingEntries = this.knownContextEntries.get(cacheKey) || new Set<string>();
      existingEntries.add(
        translationEntryId({
          targetLocale: entry.targetLocale,
          key: entry.key,
          textHash: entry.textHash,
          contextFingerprint: entry.contextFingerprint ?? undefined,
        })
      );
      this.knownContextEntries.set(cacheKey, existingEntries);
    });
  };

  private ensureKnownContextEntries = async (input: {
    targetLocale: string;
    key: string;
  }): Promise<Set<string> | null> => {
    const cacheKey = this.buildKnownContextCacheKey(input.targetLocale, input.key);
    const cachedEntries = this.knownContextEntries.get(cacheKey);
    if (cachedEntries) {
      return cachedEntries;
    }

    if (!this.fetchKnownContext) {
      return null;
    }

    const existingLoad = this.knownContextLoads.get(cacheKey);
    if (existingLoad) {
      return await existingLoad;
    }

    const loadPromise = this.fetchKnownContext(input)
      .then((result) => {
        if (!result || !Array.isArray(result.data)) {
          return null;
        }

        const knownEntries = new Set<string>();
        result.data.forEach((entry) => {
          knownEntries.add(
            translationEntryId({
              targetLocale: entry.targetLocale,
              key: entry.key,
              textHash: entry.textHash,
              contextFingerprint: entry.contextFingerprint ?? undefined,
            })
          );
        });
        this.knownContextEntries.set(cacheKey, knownEntries);
        return knownEntries;
      })
      .finally(() => {
        this.knownContextLoads.delete(cacheKey);
      });

    this.knownContextLoads.set(cacheKey, loadPromise);
    return await loadPromise;
  };
}
