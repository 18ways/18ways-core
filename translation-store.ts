import set from 'set-value';
import type { FetchTranslationsResult, InProgressTranslation, Translations } from './common';
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

const ERROR_CACHE_TTL_MS = 1000 * 60;

const translationEntryTriple = (
  entry: Pick<InProgressTranslation, 'targetLocale' | 'key' | 'textsHash'>
) => JSON.stringify([entry.targetLocale, entry.key, entry.textsHash]);

const isCaptureEntry = (
  entry: Pick<InProgressTranslation, 'baseLocale' | 'targetLocale'>
): boolean => {
  return Boolean(entry.baseLocale && entry.targetLocale && entry.baseLocale === entry.targetLocale);
};

export const translationEntryId = (
  entry: Pick<InProgressTranslation, 'targetLocale' | 'key' | 'textsHash' | 'contextFingerprint'>
) =>
  JSON.stringify([
    entry.targetLocale,
    entry.key,
    entry.textsHash,
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
  private listeners = new Set<() => void>();
  private translationListeners = new Set<() => void>();
  private pending = new Map<string, InProgressTranslation>();
  private inFlight = new Set<string>();
  private completed = new Set<string>();
  private pendingByKey = new Map<string, number>();
  private inFlightByKey = new Map<string, number>();
  private errorCache = new Map<string, number>();
  private flushPromise: Promise<void> | null = null;
  private flushScheduled = false;
  private version = 0;
  private snapshot: TranslationStoreSnapshot;
  private translationSnapshot: TranslationDataSnapshot;

  constructor(options: { translations: Translations; fetchTranslations: FetchTranslationsFn }) {
    this.translations = options.translations;
    this.fetchTranslations = options.fetchTranslations;
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

  getTranslation = (locale: string, key: string, textsHash: string): string[] | undefined => {
    return getPath(this.translations, [locale, key, textsHash]) as string[] | undefined;
  };

  isInFlight = (id: string): boolean => this.inFlight.has(id);

  hasCompletedEntry = (
    entry: Pick<InProgressTranslation, 'targetLocale' | 'key' | 'textsHash' | 'contextFingerprint'>
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

  setCompletedTranslation = (keyPath: string[], translation: string[]): void => {
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
      this.getTranslation(entry.targetLocale, entry.key, entry.textsHash)
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
        const result = await this.fetchTranslations(batch);
        if (!result || !Array.isArray(result.data) || !Array.isArray(result.errors)) {
          throw new Error('Invalid translation response');
        }

        const successfulRequestIds = new Set<string>();
        const successfulRequestTriples = new Set<string>();

        result.data.forEach(({ locale, key, textsHash, translation, contextFingerprint }) => {
          set(this.translations, [locale, key, textsHash], translation);
          successfulRequestTriples.add(
            translationEntryTriple({
              targetLocale: locale,
              key,
              textsHash,
            })
          );
          successfulRequestIds.add(
            translationEntryId({
              targetLocale: locale,
              key,
              textsHash,
              contextFingerprint: contextFingerprint ?? undefined,
            })
          );
        });

        result.errors.forEach(({ locale, key, textsHash, contextFingerprint }) => {
          const id = translationEntryId({
            targetLocale: locale,
            key,
            textsHash,
            contextFingerprint: contextFingerprint ?? undefined,
          });
          this.errorCache.set(id, Date.now() + ERROR_CACHE_TTL_MS);
        });

        // If the backend does not acknowledge a requested entry at all, treat it
        // as a temporary error to avoid infinite retry loops.
        batch.forEach((entry) => {
          const id = translationEntryId(entry);
          const triple = translationEntryTriple(entry);
          if (successfulRequestIds.has(id) || successfulRequestTriples.has(triple)) {
            this.completed.add(id);
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
}
