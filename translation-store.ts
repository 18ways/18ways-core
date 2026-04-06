import set from 'set-value';
import {
  buildTranslationFallbackValue,
  DEFAULT_TRANSLATION_FALLBACK_CONFIG,
  type FetchConfigResult,
  type FetchKnownContextResult,
  type FetchKnownResult,
  type FetchSeedResult,
  type FetchTranslationsResult,
  type InProgressTranslation,
  type KnownTranslationEntry,
  resolveAcceptedLocales,
  resolveTranslationFallbackMode,
  type TranslationContextValue,
  type TranslationFallbackConfig,
  type TranslationStoreHydrationPayload,
  type Translations,
} from './common';
import { normalizeTranslationContextFingerprint } from './context-fingerprint';
import { decryptTranslationValue } from './crypto';
import { canonicalizeLocale } from './i18n-shared';
import { cloneDeepValue, deepMerge, getPath } from './object-utils';

type FetchTranslationsFn = (
  toTranslate: InProgressTranslation[]
) => Promise<FetchTranslationsResult | undefined>;

type FetchKnownFn = (entries: KnownTranslationEntry[]) => Promise<FetchKnownResult | undefined>;

type FetchKnownContextFn = (input: {
  targetLocale: string;
  key: string;
}) => Promise<FetchKnownContextResult | undefined>;

type FetchSeedFn = (keys: string[], targetLocale: string) => Promise<FetchSeedResult | undefined>;

type FetchConfigFn = () => Promise<FetchConfigResult | undefined>;

type ConfigStatus = 'empty' | 'loading' | 'ready';

type SeedState =
  | {
      status: 'pending';
      promise: Promise<void>;
    }
  | {
      status: 'ready';
      promise: null;
    };

export interface TranslationStoreState {
  version: number;
  baseLocale: string;
  locale: {
    selected: string;
    settled: string | null;
  };
  config: {
    status: ConfigStatus;
    acceptedLocales: string[];
    translationFallback: TranslationFallbackConfig;
  };
  translations: Translations;
}

export interface TranslationStoreConfigInput {
  acceptedLocales?: string[];
  translationFallback?: TranslationFallbackConfig;
}

export interface TranslationStoreDehydratedState
  extends Required<TranslationStoreHydrationPayload> {}

export interface TranslationStoreIdleOptions {
  contextKey?: string;
  includeBackground?: boolean;
  timeoutMs?: number;
}

export interface TranslationStoreIdleState {
  timedOut: boolean;
  promise: Promise<void> | null;
}

export interface TranslationStoreEntryInput {
  contextKey: string;
  textHash: string;
  text: string;
  baseLocale?: string;
  targetLocale?: string;
  contextFingerprint?: string;
  contextMetadata?: TranslationContextValue;
}

export interface MountedTranslationStoreEntryInput extends TranslationStoreEntryInput {
  instanceId: string;
}

export type TranslationStoreSyncRead =
  | {
      status: 'ready';
      value: string;
      fallbackValue: string;
    }
  | {
      status: 'pending';
      fallbackValue: string;
      pendingValue: Promise<string>;
    };

interface SourceRegistryEntry {
  sourceKey: string;
  contextKey: string;
  textHash: string;
  text: string;
  baseLocale?: string;
  contextFingerprint?: string;
  contextMetadata?: TranslationContextValue;
  mountedInstanceCounts: Map<string, number>;
  mountedCount: number;
}

interface TimedIdleWindow {
  key: string;
  locale: string;
  contextKey: string | null;
  timeoutMs: number;
  startedAt: number;
  promise: Promise<void>;
}

interface TranslationStoreOptions {
  baseLocale: string;
  locale?: string;
  translations?: Translations;
  acceptedLocales?: string[];
  translationFallback?: TranslationFallbackConfig;
  fetchTranslations: FetchTranslationsFn;
  fetchKnown?: FetchKnownFn;
  fetchKnownContext?: FetchKnownContextFn;
  fetchSeed?: FetchSeedFn;
  fetchConfig?: FetchConfigFn;
  enableMountAwareGarbageCollection?: boolean;
  mountAwareGarbageCollectionDelayMs?: number;
}

const ERROR_CACHE_TTL_MS = 1000 * 60;
const DEFAULT_MOUNT_AWARE_GC_DELAY_MS = 5 * 60 * 1000;

const translationEntryTriple = (
  entry: Pick<InProgressTranslation, 'targetLocale' | 'key' | 'textHash'>
): string => JSON.stringify([entry.targetLocale, entry.key, entry.textHash]);

const translationEntryId = (
  entry: Pick<InProgressTranslation, 'targetLocale' | 'key' | 'textHash' | 'contextFingerprint'>
): string =>
  JSON.stringify([
    entry.targetLocale,
    entry.key,
    entry.textHash,
    normalizeTranslationContextFingerprint(entry.contextFingerprint),
  ]);

const sourceKeyFor = (contextKey: string, textHash: string): string => `${contextKey}::${textHash}`;

const localeContextKeyFor = (locale: string, contextKey: string): string =>
  JSON.stringify([locale, contextKey]);

const normalizeLocale = (locale: string | undefined, fallback: string): string =>
  canonicalizeLocale(locale || fallback) || fallback;

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
  private baseLocale: string;
  private selectedLocale: string;
  private settledLocale: string | null;
  private acceptedLocales: string[];
  private translationFallbackConfig: TranslationFallbackConfig;
  private configStatus: ConfigStatus;

  private fetchTranslations: FetchTranslationsFn;
  private fetchKnown?: FetchKnownFn;
  private fetchKnownContext?: FetchKnownContextFn;
  private fetchSeed?: FetchSeedFn;
  private fetchConfig?: FetchConfigFn;

  private listeners = new Set<() => void>();
  private version = 0;
  private stateSnapshot: TranslationStoreState;
  private loadConfigPromise: Promise<{
    acceptedLocales: string[];
    translationFallback: TranslationFallbackConfig;
  }> | null = null;
  private settlePromotionScheduled = false;
  private timedIdleWindows = new Map<string, TimedIdleWindow>();

  private sourceRegistry = new Map<string, SourceRegistryEntry>();
  private sourceKeysByContext = new Map<string, Set<string>>();
  private mountedInstances = new Map<
    string,
    {
      sourceKey: string;
      count: number;
    }
  >();
  private mountedContextCounts = new Map<string, number>();
  private contextGcTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private enableMountAwareGarbageCollection: boolean;
  private mountAwareGarbageCollectionDelayMs: number;

  private blockingPending = new Map<string, InProgressTranslation>();
  private blockingInFlight = new Map<string, InProgressTranslation>();
  private blockingFlushPromise: Promise<void> | null = null;
  private blockingFlushScheduled = false;
  private blockingPendingByLocaleContext = new Map<string, number>();
  private blockingInFlightByLocaleContext = new Map<string, number>();

  private baseLocaleObservationPending = new Map<string, InProgressTranslation>();
  private baseLocaleObservationInFlight = new Map<string, InProgressTranslation>();
  private baseLocaleObservationFlushPromise: Promise<void> | null = null;
  private baseLocaleObservationFlushScheduled = false;
  private completedObservations = new Set<string>();
  private knownContextEntries = new Map<string, Set<string>>();
  private knownContextLoads = new Map<string, Promise<Set<string> | null>>();

  private seedStates = new Map<string, SeedState>();
  private seedResolvers = new Map<string, () => void>();
  private queuedSeedContextsByLocale = new Map<string, Set<string>>();
  private seedFlushPromise: Promise<void> | null = null;
  private seedFlushScheduled = false;

  private errorCache = new Map<string, number>();

  constructor(options: TranslationStoreOptions) {
    this.baseLocale = normalizeLocale(options.baseLocale, 'en-GB');
    this.selectedLocale = normalizeLocale(options.locale, this.baseLocale);
    this.settledLocale = this.selectedLocale === this.baseLocale ? this.selectedLocale : null;
    this.translations = options.translations || {};
    this.acceptedLocales = [...(options.acceptedLocales || [])];
    this.translationFallbackConfig =
      options.translationFallback || DEFAULT_TRANSLATION_FALLBACK_CONFIG;
    this.configStatus =
      this.acceptedLocales.length || options.translationFallback ? 'ready' : 'empty';

    this.fetchTranslations = options.fetchTranslations;
    this.fetchKnown = options.fetchKnown;
    this.fetchKnownContext = options.fetchKnownContext;
    this.fetchSeed = options.fetchSeed;
    this.fetchConfig = options.fetchConfig;
    this.enableMountAwareGarbageCollection = Boolean(options.enableMountAwareGarbageCollection);
    this.mountAwareGarbageCollectionDelayMs =
      options.mountAwareGarbageCollectionDelayMs ?? DEFAULT_MOUNT_AWARE_GC_DELAY_MS;

    this.rememberHydratedLocaleContexts(this.translations);
    this.stateSnapshot = this.buildStateSnapshot();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): TranslationStoreState => this.stateSnapshot;

  hydrate = (input: {
    translations?: Translations;
    config?: TranslationStoreConfigInput;
  }): void => {
    let changed = false;

    if (input.translations && typeof input.translations === 'object') {
      deepMerge(this.translations, input.translations);
      this.rememberHydratedLocaleContexts(input.translations);
      changed = true;
    }

    if (input.config) {
      const acceptedLocales = Array.isArray(input.config.acceptedLocales)
        ? resolveAcceptedLocales(
            this.baseLocale,
            input.config.acceptedLocales
              .map((locale) => normalizeLocale(locale, this.baseLocale))
              .filter(Boolean)
          )
        : null;
      if (acceptedLocales) {
        this.acceptedLocales = [...acceptedLocales];
        changed = true;
      }

      if (input.config.translationFallback) {
        this.translationFallbackConfig = input.config.translationFallback;
        changed = true;
      }

      if (acceptedLocales || input.config.translationFallback) {
        this.configStatus = 'ready';
      }
    }

    if (!changed) {
      return;
    }

    this.scheduleSettlePromotion();
    this.emit();
  };

  dehydrate = (): TranslationStoreDehydratedState => ({
    translations: cloneDeepValue(this.translations) as Translations,
    config: {
      acceptedLocales: [...this.acceptedLocales],
      translationFallback: cloneDeepValue(
        this.translationFallbackConfig
      ) as TranslationFallbackConfig,
    },
  });

  loadConfig = async (): Promise<{
    acceptedLocales: string[];
    translationFallback: TranslationFallbackConfig;
  }> => {
    if (this.configStatus === 'ready') {
      return {
        acceptedLocales: [...this.acceptedLocales],
        translationFallback: this.translationFallbackConfig,
      };
    }

    if (this.loadConfigPromise) {
      return await this.loadConfigPromise;
    }

    if (!this.fetchConfig) {
      this.configStatus = 'ready';
      this.emit();
      return {
        acceptedLocales: [...this.acceptedLocales],
        translationFallback: this.translationFallbackConfig,
      };
    }

    this.configStatus = 'loading';
    this.emit();

    this.loadConfigPromise = this.fetchConfig()
      .then((result) => {
        const acceptedLocales = Array.isArray(result?.languages)
          ? result.languages.map((language) => normalizeLocale(language.code, this.baseLocale))
          : this.acceptedLocales;
        const translationFallback = result?.translationFallback || this.translationFallbackConfig;
        this.hydrate({
          config: {
            acceptedLocales,
            translationFallback,
          },
        });
        return {
          acceptedLocales: [...this.acceptedLocales],
          translationFallback: this.translationFallbackConfig,
        };
      })
      .finally(() => {
        this.loadConfigPromise = null;
      });

    return await this.loadConfigPromise;
  };

  setLocale = (locale: string): void => {
    const nextLocale = normalizeLocale(locale, this.baseLocale);
    if (nextLocale === this.selectedLocale) {
      return;
    }

    this.settledLocale = this.selectedLocale;

    this.selectedLocale = nextLocale;
    if (nextLocale === this.baseLocale) {
      this.settledLocale = nextLocale;
    }

    this.ensureRememberedSourcesForLocale(nextLocale);
    this.scheduleSettlePromotion();
    this.emit();
  };

  mount = (input: MountedTranslationStoreEntryInput): void => {
    const sourceEntry = this.rememberSourceEntry(input);
    this.cancelContextGc(sourceEntry.contextKey);

    const existing = this.mountedInstances.get(input.instanceId);
    if (existing && existing.sourceKey !== sourceEntry.sourceKey) {
      this.unmount({ instanceId: input.instanceId });
    }

    const currentInstance = this.mountedInstances.get(input.instanceId);
    if (currentInstance) {
      currentInstance.count += 1;
    } else {
      this.mountedInstances.set(input.instanceId, {
        sourceKey: sourceEntry.sourceKey,
        count: 1,
      });
    }

    sourceEntry.mountedInstanceCounts.set(
      input.instanceId,
      (sourceEntry.mountedInstanceCounts.get(input.instanceId) || 0) + 1
    );
    sourceEntry.mountedCount += 1;
    this.mountedContextCounts.set(
      sourceEntry.contextKey,
      (this.mountedContextCounts.get(sourceEntry.contextKey) || 0) + 1
    );

    this.ensureWorkForSourceEntry(sourceEntry, input);
  };

  unmount = (input: { instanceId: string }): void => {
    const mountedInstance = this.mountedInstances.get(input.instanceId);
    if (!mountedInstance) {
      return;
    }

    const sourceEntry = this.sourceRegistry.get(mountedInstance.sourceKey);
    if (mountedInstance.count <= 1) {
      this.mountedInstances.delete(input.instanceId);
    } else {
      mountedInstance.count -= 1;
    }

    if (!sourceEntry) {
      return;
    }

    const entryMountCount = sourceEntry.mountedInstanceCounts.get(input.instanceId) || 0;
    if (entryMountCount <= 1) {
      sourceEntry.mountedInstanceCounts.delete(input.instanceId);
    } else {
      sourceEntry.mountedInstanceCounts.set(input.instanceId, entryMountCount - 1);
    }

    if (sourceEntry.mountedCount > 0) {
      sourceEntry.mountedCount -= 1;
    }

    const contextCount = this.mountedContextCounts.get(sourceEntry.contextKey) || 0;
    if (contextCount <= 1) {
      this.mountedContextCounts.delete(sourceEntry.contextKey);
      this.scheduleContextGc(sourceEntry.contextKey);
      return;
    }

    this.mountedContextCounts.set(sourceEntry.contextKey, contextCount - 1);
  };

  getTranslationSync = (input: TranslationStoreEntryInput): TranslationStoreSyncRead => {
    const sourceEntry = this.rememberSourceEntry(input);
    const effectiveBaseLocale = normalizeLocale(sourceEntry.baseLocale, this.baseLocale);
    const effectiveTargetLocale = normalizeLocale(input.targetLocale, this.selectedLocale);
    const shouldInitiateReadWork = true;

    if (shouldInitiateReadWork) {
      this.ensureTranslationWorkForInput({
        ...input,
        baseLocale: effectiveBaseLocale,
        targetLocale: effectiveTargetLocale,
        contextFingerprint: sourceEntry.contextFingerprint,
        contextMetadata: sourceEntry.contextMetadata,
      });
    }

    if (effectiveTargetLocale === effectiveBaseLocale) {
      return {
        status: 'ready',
        value: sourceEntry.text,
        fallbackValue: sourceEntry.text,
      };
    }

    const transitionFallbackLocale = this.getTransitionFallbackLocale(effectiveTargetLocale);
    const holdTargetDisplay = this.shouldHoldTargetLocaleDisplay(
      effectiveTargetLocale,
      transitionFallbackLocale
    );
    const fallbackValue = this.resolveFallbackValue(
      sourceEntry,
      effectiveTargetLocale,
      transitionFallbackLocale
    );

    if (!holdTargetDisplay) {
      const selectedValue = this.readDecryptedTranslation(effectiveTargetLocale, sourceEntry);
      if (selectedValue !== null) {
        return {
          status: 'ready',
          value: selectedValue,
          fallbackValue,
        };
      }
    }

    const isPending =
      holdTargetDisplay || this.isLocaleBlocking(effectiveTargetLocale, sourceEntry.contextKey);
    if (!isPending) {
      return {
        status: 'ready',
        value: fallbackValue,
        fallbackValue,
      };
    }

    return {
      status: 'pending',
      fallbackValue,
      pendingValue: this.waitForResolvedTranslation(
        {
          ...input,
          baseLocale: effectiveBaseLocale,
          targetLocale: effectiveTargetLocale,
        },
        holdTargetDisplay
      ),
    };
  };

  getTranslation = async (input: TranslationStoreEntryInput): Promise<string> => {
    this.ensureTranslationWorkForInput(input);
    const syncRead = this.getTranslationSync(input);
    if (syncRead.status === 'ready') {
      return syncRead.value;
    }
    return syncRead.pendingValue;
  };

  isLoading = (input?: { contextKey?: string; includeBackground?: boolean }): boolean => {
    return this.isLocaleBlocking(this.selectedLocale, input?.contextKey);
  };

  waitForIdle = async (input?: {
    contextKey?: string;
    includeBackground?: boolean;
    timeoutMs?: number;
  }): Promise<void> => {
    if (!input?.timeoutMs) {
      await this.waitForLocaleIdle(this.selectedLocale, input?.contextKey);
      return;
    }

    const idleState = this.getIdleState(input);
    if (idleState.promise) {
      await idleState.promise;
    }
  };

  getIdleState = (input?: TranslationStoreIdleOptions): TranslationStoreIdleState => {
    const locale = this.selectedLocale;
    const contextKey = input?.contextKey || null;
    const isBlocking = this.isLocaleBlocking(locale, contextKey || undefined);

    if (!isBlocking) {
      this.clearTimedIdleWindowsFor(locale, contextKey);
      return {
        timedOut: false,
        promise: null,
      };
    }

    if (!input?.timeoutMs) {
      return {
        timedOut: false,
        promise: this.waitForLocaleIdle(locale, contextKey || undefined),
      };
    }

    const windowKey = JSON.stringify([locale, contextKey, input.timeoutMs]);
    const existingWindow = this.timedIdleWindows.get(windowKey);
    if (existingWindow) {
      return {
        timedOut: Date.now() - existingWindow.startedAt >= existingWindow.timeoutMs,
        promise: existingWindow.promise,
      };
    }

    const timedWindow: TimedIdleWindow = {
      key: windowKey,
      locale,
      contextKey,
      timeoutMs: input.timeoutMs,
      startedAt: Date.now(),
      promise: Promise.race([
        this.waitForLocaleIdle(locale, contextKey || undefined),
        this.createTimeoutPromise(input.timeoutMs),
      ]).then(() => undefined),
    };

    this.timedIdleWindows.set(windowKey, timedWindow);

    return {
      timedOut: false,
      promise: timedWindow.promise,
    };
  };

  private buildStateSnapshot = (): TranslationStoreState => ({
    version: this.version,
    baseLocale: this.baseLocale,
    locale: {
      selected: this.selectedLocale,
      settled: this.settledLocale,
    },
    config: {
      status: this.configStatus,
      acceptedLocales: [...this.acceptedLocales],
      translationFallback: this.translationFallbackConfig,
    },
    translations: this.translations,
  });

  private emit = (): void => {
    this.version += 1;
    this.stateSnapshot = this.buildStateSnapshot();
    this.cleanupTimedIdleWindows();
    this.listeners.forEach((listener) => listener());
  };

  private createTimeoutPromise = (timeoutMs: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, timeoutMs);
    });

  private rememberHydratedLocaleContexts = (translations: Translations): void => {
    Object.entries(translations || {}).forEach(([locale, localeTranslations]) => {
      if (
        !localeTranslations ||
        typeof localeTranslations !== 'object' ||
        Array.isArray(localeTranslations)
      ) {
        return;
      }

      Object.keys(localeTranslations).forEach((contextKey) => {
        this.markSeedReady(locale, contextKey);
      });
    });
  };

  private rememberSourceEntry = (input: TranslationStoreEntryInput): SourceRegistryEntry => {
    const sourceKey = sourceKeyFor(input.contextKey, input.textHash);
    const existing = this.sourceRegistry.get(sourceKey);
    const normalizedBaseLocale = input.baseLocale
      ? normalizeLocale(input.baseLocale, this.baseLocale)
      : existing?.baseLocale;

    if (existing) {
      existing.text = input.text;
      existing.baseLocale = normalizedBaseLocale || existing.baseLocale;
      existing.contextFingerprint = input.contextFingerprint ?? existing.contextFingerprint;
      existing.contextMetadata = input.contextMetadata ?? existing.contextMetadata;
      this.cancelContextGc(existing.contextKey);
      return existing;
    }

    const sourceEntry: SourceRegistryEntry = {
      sourceKey,
      contextKey: input.contextKey,
      textHash: input.textHash,
      text: input.text,
      baseLocale: normalizedBaseLocale,
      contextFingerprint: input.contextFingerprint,
      contextMetadata: input.contextMetadata,
      mountedInstanceCounts: new Map(),
      mountedCount: 0,
    };

    this.sourceRegistry.set(sourceKey, sourceEntry);
    const contextSources = this.sourceKeysByContext.get(input.contextKey);
    if (contextSources) {
      contextSources.add(sourceKey);
    } else {
      this.sourceKeysByContext.set(input.contextKey, new Set([sourceKey]));
    }
    this.cancelContextGc(input.contextKey);
    return sourceEntry;
  };

  private ensureTranslationWorkForInput = (input: TranslationStoreEntryInput): void => {
    const sourceEntry = this.rememberSourceEntry(input);
    const effectiveBaseLocale = normalizeLocale(sourceEntry.baseLocale, this.baseLocale);
    const effectiveTargetLocale = normalizeLocale(input.targetLocale, this.selectedLocale);

    if (effectiveTargetLocale === effectiveBaseLocale) {
      this.ensureBaseLocaleObservationForEntry(sourceEntry, effectiveBaseLocale);
      this.scheduleSettlePromotion();
      return;
    }

    this.ensureWorkForSourceEntry(sourceEntry, {
      ...input,
      baseLocale: effectiveBaseLocale,
      targetLocale: effectiveTargetLocale,
      contextFingerprint: sourceEntry.contextFingerprint,
      contextMetadata: sourceEntry.contextMetadata,
    });
  };

  private ensureRememberedSourcesForLocale = (locale: string): void => {
    this.sourceRegistry.forEach((sourceEntry) => {
      this.ensureWorkForSourceEntry(sourceEntry, { targetLocale: locale });
    });
  };

  private ensureWorkForSourceEntry = (
    sourceEntry: SourceRegistryEntry,
    input?: Partial<TranslationStoreEntryInput>
  ): void => {
    const effectiveTargetLocale = normalizeLocale(input?.targetLocale, this.selectedLocale);
    const effectiveBaseLocale = normalizeLocale(
      input?.baseLocale || sourceEntry.baseLocale,
      this.baseLocale
    );

    sourceEntry.baseLocale = effectiveBaseLocale;

    if (effectiveTargetLocale === effectiveBaseLocale) {
      this.ensureBaseLocaleObservationForEntry(sourceEntry, effectiveBaseLocale);
      return;
    }

    if (
      this.hasEncryptedTranslation(
        effectiveTargetLocale,
        sourceEntry.contextKey,
        sourceEntry.textHash
      )
    ) {
      return;
    }

    if (this.isSeedReady(effectiveTargetLocale, sourceEntry.contextKey)) {
      this.enqueueBlockingTranslation({
        baseLocale: effectiveBaseLocale,
        targetLocale: effectiveTargetLocale,
        key: sourceEntry.contextKey,
        textHash: sourceEntry.textHash,
        text: sourceEntry.text,
        contextFingerprint: sourceEntry.contextFingerprint,
        contextMetadata: sourceEntry.contextMetadata,
      });
      return;
    }

    this.ensureSeedForContext(sourceEntry.contextKey, effectiveTargetLocale);
  };

  private getTransitionFallbackLocale = (targetLocale: string): string | null => {
    if (targetLocale !== this.selectedLocale) {
      return null;
    }
    if (!this.settledLocale || this.settledLocale === this.selectedLocale) {
      return null;
    }
    return this.settledLocale;
  };

  private shouldHoldTargetLocaleDisplay = (
    targetLocale: string,
    transitionFallbackLocale: string | null
  ): boolean => {
    if (!transitionFallbackLocale) {
      return false;
    }

    if (targetLocale !== this.selectedLocale) {
      return false;
    }

    return this.isLoading();
  };

  private resolveFallbackValue = (
    sourceEntry: SourceRegistryEntry,
    targetLocale: string,
    transitionFallbackLocale: string | null
  ): string => {
    if (transitionFallbackLocale) {
      const cachedFallback = this.readDecryptedTranslation(transitionFallbackLocale, sourceEntry);
      if (cachedFallback !== null) {
        return cachedFallback;
      }
    }

    return buildTranslationFallbackValue(
      resolveTranslationFallbackMode(this.translationFallbackConfig, targetLocale),
      sourceEntry.text,
      sourceEntry.contextKey
    );
  };

  private waitForResolvedTranslation = async (
    input: TranslationStoreEntryInput,
    holdTargetDisplay: boolean
  ): Promise<string> => {
    const targetLocale = normalizeLocale(input.targetLocale, this.selectedLocale);
    if (holdTargetDisplay && targetLocale === this.selectedLocale) {
      await this.waitForLocaleIdle(targetLocale);
    } else {
      await this.waitForLocaleIdle(targetLocale, input.contextKey);
    }

    const nextRead = this.getTranslationSync(input);
    return nextRead.status === 'ready' ? nextRead.value : nextRead.fallbackValue;
  };

  private readEncryptedTranslation = (
    locale: string,
    contextKey: string,
    textHash: string
  ): string | undefined => {
    return getPath(this.translations, [locale, contextKey, textHash]) as string | undefined;
  };

  private hasEncryptedTranslation = (
    locale: string,
    contextKey: string,
    textHash: string
  ): boolean => Boolean(this.readEncryptedTranslation(locale, contextKey, textHash));

  private readDecryptedTranslation = (
    locale: string,
    sourceEntry: Pick<SourceRegistryEntry, 'contextKey' | 'textHash' | 'text'>
  ): string | null => {
    const encryptedText = this.readEncryptedTranslation(
      locale,
      sourceEntry.contextKey,
      sourceEntry.textHash
    );
    if (!encryptedText) {
      return null;
    }

    try {
      return decryptTranslationValue({
        encryptedText,
        sourceText: sourceEntry.text,
        locale,
        key: sourceEntry.contextKey,
        textHash: sourceEntry.textHash,
      });
    } catch (error) {
      console.error('[18ways] Failed to decrypt cached translation payload:', error);
      return null;
    }
  };

  private ensureBaseLocaleObservationForEntry = (
    sourceEntry: SourceRegistryEntry,
    baseLocale: string
  ): void => {
    this.enqueueBaseLocaleObservation({
      baseLocale,
      targetLocale: baseLocale,
      key: sourceEntry.contextKey,
      textHash: sourceEntry.textHash,
      text: sourceEntry.text,
      contextFingerprint: sourceEntry.contextFingerprint,
      contextMetadata: sourceEntry.contextMetadata,
    });
  };

  private enqueueBlockingTranslation = (entry: InProgressTranslation): boolean => {
    const id = translationEntryId(entry);

    if (!entry.targetLocale) {
      return false;
    }

    if (this.hasEncryptedTranslation(entry.targetLocale, entry.key, entry.textHash)) {
      return false;
    }

    if (this.blockingPending.has(id) || this.blockingInFlight.has(id) || this.isErrorCached(id)) {
      return false;
    }

    this.blockingPending.set(id, entry);
    this.adjustBlockingCount(this.blockingPendingByLocaleContext, entry.targetLocale, entry.key, 1);
    this.scheduleBlockingFlush();
    return true;
  };

  private enqueueBaseLocaleObservation = (entry: InProgressTranslation): boolean => {
    const id = translationEntryId(entry);

    if (!entry.targetLocale) {
      return false;
    }

    if (this.completedObservations.has(id)) {
      return false;
    }

    if (
      this.baseLocaleObservationPending.has(id) ||
      this.baseLocaleObservationInFlight.has(id) ||
      this.isErrorCached(id)
    ) {
      return false;
    }

    this.baseLocaleObservationPending.set(id, entry);
    this.scheduleBaseLocaleObservationFlush();
    return true;
  };

  private scheduleBlockingFlush = (): void => {
    if (this.blockingFlushScheduled) {
      return;
    }

    this.blockingFlushScheduled = true;
    queueMicrotask(() => {
      this.blockingFlushScheduled = false;
      void this.flushBlockingTranslations();
    });
  };

  private flushBlockingTranslations = async (): Promise<void> => {
    if (this.blockingFlushPromise) {
      await this.blockingFlushPromise;
      return;
    }

    this.blockingFlushPromise = this.drainBlockingTranslations().finally(() => {
      this.blockingFlushPromise = null;
      this.scheduleSettlePromotion();
      this.emit();
    });

    await this.blockingFlushPromise;
  };

  private drainBlockingTranslations = async (): Promise<void> => {
    while (this.blockingPending.size) {
      const batch = Array.from(this.blockingPending.values());
      this.blockingPending.clear();

      batch.forEach((entry) => {
        const id = translationEntryId(entry);
        this.adjustBlockingCount(
          this.blockingPendingByLocaleContext,
          entry.targetLocale,
          entry.key,
          -1
        );
        this.blockingInFlight.set(id, entry);
        this.adjustBlockingCount(
          this.blockingInFlightByLocaleContext,
          entry.targetLocale,
          entry.key,
          1
        );
      });

      this.emit();

      try {
        const result = await this.fetchTranslations(batch);
        if (!result || !Array.isArray(result.data) || !Array.isArray(result.errors)) {
          throw new Error('Invalid translation response');
        }

        const successfulRequestIds = new Set<string>();
        const successfulRequestTriples = new Set<string>();

        result.data.forEach(({ locale, key, textHash, translation, contextFingerprint }) => {
          if (this.enableMountAwareGarbageCollection && !this.sourceKeysByContext.has(key)) {
            return;
          }

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

        if (result.errors.length > 0 && typeof console !== 'undefined' && console.warn) {
          console.warn('Some translations failed');
        }

        batch.forEach((entry) => {
          const id = translationEntryId(entry);
          const triple = translationEntryTriple(entry);
          if (successfulRequestIds.has(id) || successfulRequestTriples.has(triple)) {
            return;
          }

          this.errorCache.set(id, Date.now() + ERROR_CACHE_TTL_MS);
        });

        if (result.errors.length) {
          console.warn('Some translations failed');
        }
      } catch (error) {
        console.error('Unexpected error while fetching translations:', error);
        batch.forEach((entry) => {
          this.errorCache.set(translationEntryId(entry), Date.now() + ERROR_CACHE_TTL_MS);
        });
      } finally {
        batch.forEach((entry) => {
          const id = translationEntryId(entry);
          this.blockingInFlight.delete(id);
          this.adjustBlockingCount(
            this.blockingInFlightByLocaleContext,
            entry.targetLocale,
            entry.key,
            -1
          );
        });
        this.emit();
      }
    }
  };

  private scheduleBaseLocaleObservationFlush = (): void => {
    if (this.baseLocaleObservationFlushScheduled) {
      return;
    }

    this.baseLocaleObservationFlushScheduled = true;
    queueMicrotask(() => {
      this.baseLocaleObservationFlushScheduled = false;
      void this.flushBaseLocaleObservations();
    });
  };

  private flushBaseLocaleObservations = async (): Promise<void> => {
    if (this.baseLocaleObservationFlushPromise) {
      await this.baseLocaleObservationFlushPromise;
      return;
    }

    this.baseLocaleObservationFlushPromise = this.drainBaseLocaleObservations().finally(() => {
      this.baseLocaleObservationFlushPromise = null;
      this.emit();
    });

    await this.baseLocaleObservationFlushPromise;
  };

  private drainBaseLocaleObservations = async (): Promise<void> => {
    while (this.baseLocaleObservationPending.size) {
      const batch = Array.from(this.baseLocaleObservationPending.values());
      this.baseLocaleObservationPending.clear();

      batch.forEach((entry) => {
        this.baseLocaleObservationInFlight.set(translationEntryId(entry), entry);
      });

      this.emit();

      try {
        const knownBaseLocaleObservationEntryIds = new Set<string>();
        const unknownBaseLocaleObservationEntries: InProgressTranslation[] = [];
        const baseLocaleObservationEntriesByContext = new Map<string, InProgressTranslation[]>();

        batch.forEach((entry) => {
          const cacheKey = this.buildKnownContextCacheKey(entry.targetLocale, entry.key);
          const existingEntries = baseLocaleObservationEntriesByContext.get(cacheKey);
          if (existingEntries) {
            existingEntries.push(entry);
            return;
          }
          baseLocaleObservationEntriesByContext.set(cacheKey, [entry]);
        });

        for (const contextEntries of baseLocaleObservationEntriesByContext.values()) {
          const firstEntry = contextEntries[0];
          const knownContextEntries = await this.ensureKnownContextEntries({
            targetLocale: firstEntry.targetLocale,
            key: firstEntry.key,
          });

          if (!knownContextEntries) {
            unknownBaseLocaleObservationEntries.push(...contextEntries);
            continue;
          }

          contextEntries.forEach((entry) => {
            const id = translationEntryId(entry);
            if (knownContextEntries.has(id)) {
              knownBaseLocaleObservationEntryIds.add(id);
              this.completedObservations.add(id);
              return;
            }

            unknownBaseLocaleObservationEntries.push(entry);
          });
        }

        if (unknownBaseLocaleObservationEntries.length && this.fetchKnown) {
          const knownResult = await this.fetchKnown(
            unknownBaseLocaleObservationEntries.map((entry) => ({
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
              knownBaseLocaleObservationEntryIds.add(id);
              this.completedObservations.add(id);
            });
          }
        }

        const fetchBatch = unknownBaseLocaleObservationEntries.filter(
          (entry) => !knownBaseLocaleObservationEntryIds.has(translationEntryId(entry))
        );
        if (fetchBatch.length) {
          const result = await this.fetchTranslations(fetchBatch);
          if (!result || !Array.isArray(result.data) || !Array.isArray(result.errors)) {
            throw new Error('Invalid translation response');
          }

          const successfulRequestIds = new Set<string>();
          const successfulRequestTriples = new Set<string>();

          result.data.forEach(({ locale, key, textHash, translation, contextFingerprint }) => {
            if (this.enableMountAwareGarbageCollection && !this.sourceKeysByContext.has(key)) {
              return;
            }

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

          fetchBatch.forEach((entry) => {
            const id = translationEntryId(entry);
            const triple = translationEntryTriple(entry);
            if (successfulRequestIds.has(id) || successfulRequestTriples.has(triple)) {
              this.completedObservations.add(id);
              this.rememberKnownEntries([
                {
                  targetLocale: entry.targetLocale,
                  key: entry.key,
                  textHash: entry.textHash,
                  contextFingerprint: entry.contextFingerprint ?? null,
                },
              ]);
              return;
            }

            this.errorCache.set(id, Date.now() + ERROR_CACHE_TTL_MS);
          });
        }
      } catch (error) {
        console.error('Unexpected error while observing base-locale translations:', error);
        batch.forEach((entry) => {
          this.errorCache.set(translationEntryId(entry), Date.now() + ERROR_CACHE_TTL_MS);
        });
      } finally {
        batch.forEach((entry) => {
          this.baseLocaleObservationInFlight.delete(translationEntryId(entry));
        });
        this.emit();
      }
    }
  };

  private buildKnownContextCacheKey = (targetLocale: string, key: string): string =>
    JSON.stringify([targetLocale, key]);

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

  private ensureSeedForContext = (
    contextKey: string,
    targetLocale: string
  ): Promise<void> | null => {
    const localeContextKey = localeContextKeyFor(targetLocale, contextKey);
    const existing = this.seedStates.get(localeContextKey);
    if (existing?.status === 'pending') {
      return existing.promise;
    }

    if (existing?.status === 'ready') {
      return null;
    }

    if (this.hasContextTranslations(targetLocale, contextKey)) {
      this.markSeedReady(targetLocale, contextKey);
      this.enqueueMissingTranslationsForContext(targetLocale, contextKey);
      return null;
    }

    if (!this.fetchSeed) {
      this.markSeedReady(targetLocale, contextKey);
      this.enqueueMissingTranslationsForContext(targetLocale, contextKey);
      return null;
    }

    let resolvePromise = () => {};
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    this.seedStates.set(localeContextKey, {
      status: 'pending',
      promise,
    });
    this.seedResolvers.set(localeContextKey, resolvePromise);

    const queuedContexts = this.queuedSeedContextsByLocale.get(targetLocale);
    if (queuedContexts) {
      queuedContexts.add(contextKey);
    } else {
      this.queuedSeedContextsByLocale.set(targetLocale, new Set([contextKey]));
    }

    if (!this.seedFlushScheduled) {
      this.seedFlushScheduled = true;
      queueMicrotask(() => {
        this.seedFlushScheduled = false;
        void this.flushSeedBatches();
      });
    }

    return promise;
  };

  private flushSeedBatches = async (): Promise<void> => {
    if (this.seedFlushPromise) {
      await this.seedFlushPromise;
      return;
    }

    this.seedFlushPromise = this.drainSeedBatches().finally(() => {
      this.seedFlushPromise = null;
      this.scheduleSettlePromotion();
      this.emit();
    });

    await this.seedFlushPromise;
  };

  private drainSeedBatches = async (): Promise<void> => {
    while (this.queuedSeedContextsByLocale.size > 0) {
      const batches = Array.from(this.queuedSeedContextsByLocale.entries()).map(
        ([locale, contextKeys]) => [locale, Array.from(contextKeys)] as const
      );
      this.queuedSeedContextsByLocale.clear();

      await Promise.all(
        batches.map(async ([locale, contextKeys]) => {
          try {
            const seedResult = await this.fetchSeed?.(contextKeys, locale);
            if (
              seedResult?.data &&
              typeof seedResult.data === 'object' &&
              !Array.isArray(seedResult.data)
            ) {
              deepMerge(this.translations, {
                [locale]: seedResult.data,
              });
              this.rememberHydratedLocaleContexts({
                [locale]: seedResult.data,
              });
            }
          } catch (error) {
            console.error('[18ways] Failed to seed initial context translations:', error);
          } finally {
            contextKeys.forEach((contextKey) => {
              this.markSeedReady(locale, contextKey);
              this.enqueueMissingTranslationsForContext(locale, contextKey);
            });
            this.emit();
          }
        })
      );
    }
  };

  private markSeedReady = (locale: string, contextKey: string): void => {
    const localeContextKey = localeContextKeyFor(locale, contextKey);
    const resolve = this.seedResolvers.get(localeContextKey);
    if (resolve) {
      resolve();
      this.seedResolvers.delete(localeContextKey);
    }

    this.seedStates.set(localeContextKey, {
      status: 'ready',
      promise: null,
    });
  };

  private isSeedReady = (locale: string, contextKey: string): boolean => {
    const seedState = this.seedStates.get(localeContextKeyFor(locale, contextKey));
    return seedState?.status === 'ready' || this.hasContextTranslations(locale, contextKey);
  };

  private hasContextTranslations = (locale: string, contextKey: string): boolean => {
    const localeTranslations = this.translations[locale] as Record<string, unknown> | undefined;
    return Boolean(
      localeTranslations &&
        typeof localeTranslations === 'object' &&
        !Array.isArray(localeTranslations) &&
        contextKey in localeTranslations
    );
  };

  private enqueueMissingTranslationsForContext = (locale: string, contextKey: string): void => {
    const sourceKeys = this.sourceKeysByContext.get(contextKey);
    if (!sourceKeys?.size) {
      return;
    }

    sourceKeys.forEach((sourceKey) => {
      const sourceEntry = this.sourceRegistry.get(sourceKey);
      if (!sourceEntry) {
        return;
      }

      const entryBaseLocale = normalizeLocale(sourceEntry.baseLocale, this.baseLocale);
      if (entryBaseLocale === locale) {
        this.ensureBaseLocaleObservationForEntry(sourceEntry, entryBaseLocale);
        return;
      }

      this.enqueueBlockingTranslation({
        baseLocale: entryBaseLocale,
        targetLocale: locale,
        key: sourceEntry.contextKey,
        textHash: sourceEntry.textHash,
        text: sourceEntry.text,
        contextFingerprint: sourceEntry.contextFingerprint,
        contextMetadata: sourceEntry.contextMetadata,
      });
    });
  };

  private adjustBlockingCount = (
    bucket: Map<string, number>,
    locale: string,
    contextKey: string,
    delta: number
  ): void => {
    const key = localeContextKeyFor(locale, contextKey);
    const nextValue = (bucket.get(key) ?? 0) + delta;
    if (nextValue <= 0) {
      bucket.delete(key);
      return;
    }
    bucket.set(key, nextValue);
  };

  private isLocaleBlocking = (locale: string, contextKey?: string): boolean => {
    const targetContextKey = contextKey || null;
    const hasBlockingPending = Array.from(this.blockingPendingByLocaleContext.entries()).some(
      ([key, count]) => count > 0 && this.matchesLocaleContextKey(key, locale, targetContextKey)
    );
    if (hasBlockingPending) {
      return true;
    }

    const hasBlockingInFlight = Array.from(this.blockingInFlightByLocaleContext.entries()).some(
      ([key, count]) => count > 0 && this.matchesLocaleContextKey(key, locale, targetContextKey)
    );
    if (hasBlockingInFlight) {
      return true;
    }

    return Array.from(this.seedStates.entries()).some(
      ([key, seedState]) =>
        seedState.status === 'pending' &&
        this.matchesLocaleContextKey(key, locale, targetContextKey)
    );
  };

  private matchesLocaleContextKey = (
    localeContextKey: string,
    locale: string,
    contextKey: string | null
  ): boolean => {
    try {
      const parsed = JSON.parse(localeContextKey);
      if (!Array.isArray(parsed) || parsed[0] !== locale) {
        return false;
      }
      if (contextKey === null) {
        return true;
      }
      return parsed[1] === contextKey;
    } catch {
      return false;
    }
  };

  private waitForLocaleIdle = async (locale: string, contextKey?: string): Promise<void> => {
    while (this.isLocaleBlocking(locale, contextKey)) {
      const seedPromises = Array.from(this.seedStates.entries())
        .filter(
          ([key, seedState]) =>
            seedState.status === 'pending' &&
            this.matchesLocaleContextKey(key, locale, contextKey || null)
        )
        .map(([, seedState]) => seedState.promise);

      if (seedPromises.length) {
        await Promise.all(seedPromises);
        continue;
      }

      const hasPendingBlockingEntries = Array.from(
        this.blockingPendingByLocaleContext.entries()
      ).some(
        ([key, count]) => count > 0 && this.matchesLocaleContextKey(key, locale, contextKey || null)
      );
      if (hasPendingBlockingEntries) {
        await this.flushBlockingTranslations();
        continue;
      }

      if (this.blockingFlushPromise) {
        await this.blockingFlushPromise;
        continue;
      }

      await Promise.resolve();
    }

    if (locale === this.selectedLocale && this.maybePromoteSelectedLocaleToSettled()) {
      this.emit();
    }
  };

  private clearTimedIdleWindowsFor = (locale: string, contextKey: string | null): void => {
    Array.from(this.timedIdleWindows.entries()).forEach(([windowKey, timedWindow]) => {
      if (timedWindow.locale !== locale) {
        return;
      }
      if (timedWindow.contextKey !== contextKey) {
        return;
      }
      this.timedIdleWindows.delete(windowKey);
    });
  };

  private cleanupTimedIdleWindows = (): void => {
    Array.from(this.timedIdleWindows.entries()).forEach(([windowKey, timedWindow]) => {
      if (timedWindow.locale !== this.selectedLocale) {
        this.timedIdleWindows.delete(windowKey);
        return;
      }

      if (!this.isLocaleBlocking(timedWindow.locale, timedWindow.contextKey || undefined)) {
        this.timedIdleWindows.delete(windowKey);
      }
    });
  };

  private maybePromoteSelectedLocaleToSettled = (): boolean => {
    if (this.selectedLocale === this.baseLocale) {
      if (this.settledLocale === this.selectedLocale) {
        return false;
      }
      this.settledLocale = this.selectedLocale;
      return true;
    }

    if (this.isLoading()) {
      return false;
    }

    if (this.settledLocale === this.selectedLocale) {
      return false;
    }

    this.settledLocale = this.selectedLocale;
    return true;
  };

  private scheduleSettlePromotion = (): void => {
    if (this.settlePromotionScheduled) {
      return;
    }

    this.settlePromotionScheduled = true;
    queueMicrotask(() => {
      this.settlePromotionScheduled = false;
      if (this.maybePromoteSelectedLocaleToSettled()) {
        this.emit();
      }
    });
  };

  private isErrorCached = (id: string): boolean => {
    const expiry = this.errorCache.get(id);
    return typeof expiry === 'number' && Date.now() < expiry;
  };

  private cancelContextGc = (contextKey: string): void => {
    const timeoutId = this.contextGcTimeouts.get(contextKey);
    if (!timeoutId) {
      return;
    }

    clearTimeout(timeoutId);
    this.contextGcTimeouts.delete(contextKey);
  };

  private scheduleContextGc = (contextKey: string): void => {
    if (!this.enableMountAwareGarbageCollection) {
      return;
    }

    this.cancelContextGc(contextKey);
    this.contextGcTimeouts.set(
      contextKey,
      setTimeout(() => {
        this.contextGcTimeouts.delete(contextKey);
        if ((this.mountedContextCounts.get(contextKey) || 0) > 0) {
          return;
        }
        this.pruneContext(contextKey);
      }, this.mountAwareGarbageCollectionDelayMs)
    );
  };

  private pruneContext = (contextKey: string): void => {
    let changed = false;

    this.cancelContextGc(contextKey);
    this.mountedContextCounts.delete(contextKey);

    Object.keys(this.translations).forEach((locale) => {
      const localeTranslations = this.translations[locale] as Record<string, unknown> | undefined;
      if (!localeTranslations || typeof localeTranslations !== 'object') {
        return;
      }

      if (!(contextKey in localeTranslations)) {
        return;
      }

      delete localeTranslations[contextKey];
      changed = true;

      if (!Object.keys(localeTranslations).length) {
        delete this.translations[locale];
      }
    });

    const sourceKeys = this.sourceKeysByContext.get(contextKey);
    if (sourceKeys) {
      sourceKeys.forEach((sourceKey) => {
        this.sourceRegistry.delete(sourceKey);
        Array.from(this.mountedInstances.entries()).forEach(([instanceId, mountedInstance]) => {
          if (mountedInstance.sourceKey === sourceKey) {
            this.mountedInstances.delete(instanceId);
          }
        });
      });
      this.sourceKeysByContext.delete(contextKey);
      changed = true;
    }

    Array.from(this.completedObservations).forEach((entryId) => {
      if (entryMatchesContextKey(entryId, contextKey)) {
        this.completedObservations.delete(entryId);
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

    Array.from(this.seedStates.keys()).forEach((localeContextKey) => {
      try {
        const parsed = JSON.parse(localeContextKey);
        if (Array.isArray(parsed) && parsed[1] === contextKey) {
          this.seedStates.delete(localeContextKey);
          this.seedResolvers.delete(localeContextKey);
        }
      } catch {}
    });

    Array.from(this.queuedSeedContextsByLocale.entries()).forEach(([locale, queuedContexts]) => {
      queuedContexts.delete(contextKey);
      if (!queuedContexts.size) {
        this.queuedSeedContextsByLocale.delete(locale);
      }
    });

    Array.from(this.blockingPending.entries()).forEach(([entryId, entry]) => {
      if (entry.key !== contextKey) {
        return;
      }
      this.blockingPending.delete(entryId);
      this.adjustBlockingCount(
        this.blockingPendingByLocaleContext,
        entry.targetLocale,
        entry.key,
        -1
      );
      changed = true;
    });

    Array.from(this.baseLocaleObservationPending.entries()).forEach(([entryId, entry]) => {
      if (entry.key !== contextKey) {
        return;
      }
      this.baseLocaleObservationPending.delete(entryId);
      changed = true;
    });

    if (changed) {
      this.scheduleSettlePromotion();
      this.emit();
    }
  };

  private getContextKeyFromKnownContextCacheKey = (cacheKey: string): string | null => {
    try {
      const parsed = JSON.parse(cacheKey);
      return Array.isArray(parsed) && typeof parsed[1] === 'string' ? parsed[1] : null;
    } catch {
      return null;
    }
  };
}
