import type {} from './global';
import { encryptTranslationValue, generateHashIdV2 } from './crypto';
import { canonicalizeLocale } from './i18n-shared';
import { deepMerge } from './object-utils';
import {
  isRichTextMarkup,
  mapRichTextTextNodes,
  parseRichTextSourceMarkup,
  serializeRichTextToMarkup,
} from './rich-text';

export interface Translations {
  // Leaf values store encrypted translation payload strings.
  [key: string]: string | Translations;
}

export type Fetcher = typeof fetch;
export type _RequestInitLike = RequestInit & Record<string, unknown>;
export type _RequestInitDecorator = (input: {
  url: string;
  method: string;
  requestInit: _RequestInitLike;
  cacheTtlSeconds: number;
}) => _RequestInitLike;

interface InitOptions {
  key?: string;
  baseLocale?: string;
  apiUrl?: string;
  fetcher?: Fetcher;
  cacheTtlSeconds?: number;
  /** @internal Adapter-only fetch init hook. */
  _requestInitDecorator?: _RequestInitDecorator;
}

export interface FetchRequestOptions {
  origin?: string;
}

export type SnapshotTranslationEntry = {
  key: string;
  textHash: string;
  translationId: string;
  contextFingerprint?: string | null;
};

export interface TranslationContextValue {
  name: string;
  label: string;
  treePath: string;
  filePath: string;
}

export type TranslationFallbackMode = 'source' | 'blank' | 'key';

export interface TranslationFallbackConfig {
  default: TranslationFallbackMode;
  overrides: Array<{
    locale: string;
    fallback: TranslationFallbackMode;
  }>;
}

export interface TranslationStoreHydrationPayload {
  translations?: Translations;
  config?: {
    acceptedLocales?: string[];
    translationFallback?: TranslationFallbackConfig;
  };
}

export interface ResolvedTranslationStoreHydrationPayload {
  translations: Translations;
  config: {
    acceptedLocales: string[];
    translationFallback: TranslationFallbackConfig;
  };
}

export const DEFAULT_TRANSLATION_FALLBACK_CONFIG: TranslationFallbackConfig = {
  default: 'source',
  overrides: [],
};

export interface TranslationContextInputObject {
  name: string;
  label?: string;
  description?: string;
  treePath?: string;
  filePath?: string;
}

export type TranslationContextInput = string | TranslationContextInputObject;

export interface InProgressTranslation {
  key: string;
  textHash: string;
  baseLocale?: string;
  targetLocale: string;
  text: string;
  contextFingerprint?: string;
  contextMetadata?: TranslationContextValue;
}

export interface KnownTranslationEntry {
  key: string;
  textHash: string;
  targetLocale: string;
  contextFingerprint?: string | null;
}

export interface FetchTranslationsResult {
  data: Array<{
    locale: string;
    key: string;
    textHash: string;
    translationId: string;
    contextFingerprint?: string | null;
    // AES-encrypted translation payload.
    translation: string;
  }>;
  errors: Array<{
    locale: string;
    key: string;
    textHash: string;
    contextFingerprint?: string | null;
  }>;
  snapshotRequestTranslationIds?: string[];
}

export interface FetchKnownResult {
  data: KnownTranslationEntry[];
  errors: Array<{
    targetLocale: string;
    key: string;
    textHash: string;
    contextFingerprint?: string | null;
  }>;
}

export interface FetchKnownContextResult {
  data: KnownTranslationEntry[];
  errors: Array<{
    targetLocale: string;
    key: string;
  }>;
}

export interface FetchSeedResult {
  data: Translations;
  errors?: Array<{ key?: string; targetLocale?: string; hash_id?: string; reason?: string }>;
  usage?: {
    wordsRetrieved: number;
    translationsRetrieved: number;
  };
  translationEntries?: SnapshotTranslationEntry[];
  snapshotRequestTranslationIds?: string[];
}

export interface FetchConfigResult {
  languages: Language[];
  total: number;
  translationFallback: TranslationFallbackConfig;
}

export type RuntimeNetworkEvent =
  | {
      type: 'known';
      request: KnownTranslationEntry[];
      result: FetchKnownResult | undefined;
    }
  | {
      type: 'seed';
      targetLocale: string;
      keys: string[];
      result: FetchSeedResult;
    }
  | {
      type: 'translate';
      request: InProgressTranslation[];
      result: FetchTranslationsResult;
    };

const RUNTIME_NETWORK_EVENT_BUFFER_LIMIT = 50;
const runtimeNetworkListeners = new Set<(event: RuntimeNetworkEvent) => void>();
const runtimeNetworkEventBuffer: RuntimeNetworkEvent[] = [];

export const subscribeRuntimeNetworkEvents = (
  listener: (event: RuntimeNetworkEvent) => void,
  options?: { replayBuffered?: boolean }
): (() => void) => {
  runtimeNetworkListeners.add(listener);

  if (options?.replayBuffered) {
    runtimeNetworkEventBuffer.forEach((event) => {
      try {
        listener(event);
      } catch (error) {
        console.error('[18ways] runtime network event listener failed during replay:', error);
      }
    });
  }

  return () => {
    runtimeNetworkListeners.delete(listener);
  };
};

export const clearRuntimeNetworkEventsForTesting = (): void => {
  runtimeNetworkEventBuffer.length = 0;
};

const emitRuntimeNetworkEvent = (event: RuntimeNetworkEvent): void => {
  runtimeNetworkEventBuffer.push(event);
  if (runtimeNetworkEventBuffer.length > RUNTIME_NETWORK_EVENT_BUFFER_LIMIT) {
    runtimeNetworkEventBuffer.splice(
      0,
      runtimeNetworkEventBuffer.length - RUNTIME_NETWORK_EVENT_BUFFER_LIMIT
    );
  }

  runtimeNetworkListeners.forEach((listener) => {
    try {
      listener(event);
    } catch (error) {
      console.error('[18ways] runtime network event listener failed:', error);
    }
  });
};

type FetchXQueryValue = string | number | boolean;

interface FetchXOptions<T> {
  url: string;
  method: string;
  payload?: { payload: InProgressTranslation[] } | Record<string, unknown>;
  queryParams?: Record<string, FetchXQueryValue | FetchXQueryValue[] | null | undefined>;
  requestOptions?: FetchRequestOptions;
  onError: (error: Error) => T;
}

const DEFAULT_18WAYS_API_URL = 'https://internal.18ways.com/api';
const DEFAULT_LOCALE = 'en-GB';
const DEFAULT_ORIGIN = 'http://localhost:3000';
const DEMO_API_KEY = 'pk_dummy_demo_token';
const DEMO_LOCALE_SUFFIX = '-x-caesar';

let apiKey: string | undefined;
let configuredBaseLocale: string | undefined;
let apiUrl: string | undefined;
let customFetcher: Fetcher | undefined;
let customRequestInitDecorator: _RequestInitDecorator | undefined;
let serverCache: Translations | null = null;
const DEFAULT_CACHE_TTL_SECONDS = 10 * 60;
let cacheTtlSeconds = DEFAULT_CACHE_TTL_SECONDS;

const normalizeOrigin = (origin: string): string => origin.replace(/\/$/, '');

const resolveApiBase = (explicitApiUrl?: string | null): string =>
  normalizeOrigin(explicitApiUrl || DEFAULT_18WAYS_API_URL);

const joinApiBaseAndPath = (base: string, path: string): string => {
  const normalizedBase = normalizeOrigin(base);
  if (!path.startsWith('/api/')) {
    return `${normalizedBase}${path}`;
  }

  if (normalizedBase.endsWith('/api')) {
    return `${normalizedBase}${path.slice(4)}`;
  }

  return `${normalizedBase}${path}`;
};

export const isDemoApiKey = (candidate?: string): boolean => candidate === DEMO_API_KEY;

const buildDemoLocale = (baseLocale?: string | null): string => {
  const canonicalBaseLocale = canonicalizeLocale(baseLocale || DEFAULT_LOCALE) || DEFAULT_LOCALE;
  const normalizedBaseLocale = canonicalBaseLocale.replace(/-x-.+$/i, '');
  return `${normalizedBaseLocale}${DEMO_LOCALE_SUFFIX}`;
};

const getBaseLocaleFromDemoLocale = (locale: string): string | null => {
  const canonicalLocale = canonicalizeLocale(locale);
  const match = canonicalLocale.match(/^(.*)-x-caesar$/i);
  return match?.[1] || null;
};

const isDemoLocaleForBaseLocale = (locale: string, baseLocale?: string | null): boolean => {
  const canonicalLocale = canonicalizeLocale(locale);
  return canonicalLocale.toLowerCase() === buildDemoLocale(baseLocale).toLowerCase();
};

const rot13Char = (char: string): string => {
  const code = char.charCodeAt(0);

  if (code >= 65 && code <= 90) {
    return String.fromCharCode(((code - 65 + 13) % 26) + 65);
  }

  if (code >= 97 && code <= 122) {
    return String.fromCharCode(((code - 97 + 13) % 26) + 97);
  }

  return char;
};

const rot13 = (value: string): string => value.replace(/[A-Za-z]/g, rot13Char);

const rot13TranslationText = (text: string): string => {
  if (isRichTextMarkup(text)) {
    const parsed = parseRichTextSourceMarkup(text);
    if (parsed.value) {
      return serializeRichTextToMarkup(mapRichTextTextNodes(parsed.value, rot13).nodes);
    }
  }

  return rot13(text);
};

export const getDemoLanguageInfo = (locale: string): Language | null => {
  const baseLocale = getBaseLocaleFromDemoLocale(locale);
  if (!baseLocale) {
    return null;
  }

  return {
    code: canonicalizeLocale(locale),
    name: 'Caesar Shift',
    nativeName: 'Caesar Shift',
    flag: '🔄',
  };
};

const createDemoConfig = (baseLocale?: string | null): FetchConfigResult => {
  const resolvedBaseLocale = canonicalizeLocale(baseLocale || DEFAULT_LOCALE) || DEFAULT_LOCALE;
  const demoLocale = buildDemoLocale(resolvedBaseLocale);

  return {
    languages: [
      {
        code: resolvedBaseLocale,
        name: resolvedBaseLocale,
        nativeName: resolvedBaseLocale,
      },
      getDemoLanguageInfo(demoLocale)!,
    ],
    total: 2,
    translationFallback: DEFAULT_TRANSLATION_FALLBACK_CONFIG,
  };
};

const createDemoTranslationResult = (
  toTranslate: InProgressTranslation[]
): FetchTranslationsResult => {
  const data: FetchTranslationsResult['data'] = [];
  const errors: FetchTranslationsResult['errors'] = [];

  toTranslate.forEach((entry) => {
    const baseLocale = canonicalizeLocale(entry.baseLocale || DEFAULT_LOCALE) || DEFAULT_LOCALE;
    const targetLocale = canonicalizeLocale(entry.targetLocale);

    if (!targetLocale || !entry.key || !entry.textHash || typeof entry.text !== 'string') {
      return;
    }

    if (baseLocale === targetLocale) {
      return;
    }

    if (!isDemoLocaleForBaseLocale(targetLocale, baseLocale)) {
      errors.push({
        locale: targetLocale,
        key: entry.key,
        textHash: entry.textHash,
        contextFingerprint: entry.contextFingerprint ?? null,
      });
      return;
    }

    data.push({
      locale: targetLocale,
      key: entry.key,
      textHash: entry.textHash,
      translationId: entry.textHash,
      contextFingerprint: entry.contextFingerprint ?? null,
      translation: encryptTranslationValue({
        translatedText: rot13TranslationText(entry.text),
        sourceText: entry.text,
        locale: targetLocale,
        key: entry.key,
        textHash: entry.textHash,
      }),
    });
  });

  return { data, errors };
};

const parseLocalesFromApiResponse = (data: any): string[] => {
  const locales: string[] = [];
  const languages = Array.isArray(data?.languages) ? data.languages : [];

  for (const language of languages) {
    if (typeof language === 'string') {
      locales.push(language);
      continue;
    }

    if (language && typeof language.code === 'string') {
      locales.push(language.code);
    }
  }

  return Array.from(new Set(locales.map(canonicalizeLocale).filter(Boolean)));
};

const isTranslationFallbackMode = (value: unknown): value is TranslationFallbackMode =>
  value === 'source' || value === 'blank' || value === 'key';

type TranslationFallbackOverrideInput = {
  locale?: unknown;
  fallback?: unknown;
};

const normalizeTranslationFallbackConfig = (value: any): TranslationFallbackConfig => {
  const defaultFallback = isTranslationFallbackMode(value?.default) ? value.default : 'source';
  const rawOverrides: TranslationFallbackOverrideInput[] = Array.isArray(value?.overrides)
    ? value.overrides
    : [];

  return {
    default: defaultFallback,
    overrides: rawOverrides
      .map((override) => {
        const locale = canonicalizeLocale(
          typeof override?.locale === 'string' ? override.locale : ''
        );
        const fallback = isTranslationFallbackMode(override?.fallback) ? override.fallback : null;
        if (!locale || !fallback) {
          return null;
        }
        return { locale, fallback };
      })
      .filter((override): override is { locale: string; fallback: TranslationFallbackMode } =>
        Boolean(override)
      ),
  };
};

const normalizeAcceptedLocaleList = (
  locales: ReadonlyArray<string | null | undefined> = []
): string[] => {
  return Array.from(
    new Set(locales.map((locale) => canonicalizeLocale(locale || '')).filter(Boolean))
  );
};

export const ensureBaseLocaleAccepted = (
  baseLocale?: string | null,
  locales: string[] = []
): string[] => {
  const normalizedBaseLocale = baseLocale ? canonicalizeLocale(baseLocale) : '';
  const normalizedLocales = normalizeAcceptedLocaleList(locales);

  if (!normalizedBaseLocale) {
    return normalizedLocales;
  }

  return [
    normalizedBaseLocale,
    ...normalizedLocales.filter((locale) => locale !== normalizedBaseLocale),
  ];
};

export const resolveAcceptedLocales = (
  baseLocale?: string | null,
  ...localeSources: Array<ReadonlyArray<string | null | undefined> | null | undefined>
): string[] => {
  return ensureBaseLocaleAccepted(
    baseLocale,
    normalizeAcceptedLocaleList(localeSources.flatMap((locales) => locales || []))
  );
};

export const resolveTranslationFallbackMode = (
  config: TranslationFallbackConfig | null | undefined,
  locale: string
): TranslationFallbackMode => {
  const normalizedLocale = canonicalizeLocale(locale);
  const normalizedConfig = config || DEFAULT_TRANSLATION_FALLBACK_CONFIG;
  const override = normalizedConfig.overrides.find((entry) => entry.locale === normalizedLocale);
  return override?.fallback || normalizedConfig.default;
};

export const buildTranslationFallbackValue = (
  fallbackMode: TranslationFallbackMode,
  sourceText: string,
  key: string
): string => {
  const richSourceValue = isRichTextMarkup(sourceText)
    ? parseRichTextSourceMarkup(sourceText).value
    : null;

  if (richSourceValue) {
    if (fallbackMode === 'blank') {
      return serializeRichTextToMarkup(mapRichTextTextNodes(richSourceValue, () => '').nodes);
    }
    if (fallbackMode === 'key') {
      return serializeRichTextToMarkup(mapRichTextTextNodes(richSourceValue, () => key).nodes);
    }
    return sourceText;
  }

  if (fallbackMode === 'blank') {
    return '';
  }
  if (fallbackMode === 'key') {
    return key;
  }
  return sourceText;
};

export const resolveOrigin = (input: {
  explicitOrigin?: string | null;
  host?: string | null;
  forwardedProto?: string | null;
  fallbackOrigin?: string | null;
}): string => {
  if (input.explicitOrigin) {
    return normalizeOrigin(input.explicitOrigin);
  }

  if (input.host) {
    const proto = input.forwardedProto || 'https';
    return `${proto}://${input.host}`;
  }

  if (input.fallbackOrigin) {
    return normalizeOrigin(input.fallbackOrigin);
  }

  return DEFAULT_ORIGIN;
};

export const _composeRequestInitDecorators = (
  ...decorators: Array<_RequestInitDecorator | undefined>
): _RequestInitDecorator | undefined => {
  const activeDecorators = decorators.filter(
    (decorator): decorator is _RequestInitDecorator => typeof decorator === 'function'
  );

  if (!activeDecorators.length) {
    return undefined;
  }

  return ({ url, method, requestInit, cacheTtlSeconds }) =>
    activeDecorators.reduce<_RequestInitLike>((currentRequestInit, decorator) => {
      return decorator({
        url,
        method,
        requestInit: currentRequestInit,
        cacheTtlSeconds,
      });
    }, requestInit);
};

export const fetchAcceptedLocales = async (
  fallbackLocale?: string,
  options?: FetchRequestOptions
): Promise<string[]> => {
  const defaultLocale = canonicalizeLocale(fallbackLocale || DEFAULT_LOCALE);

  if (!apiKey) {
    return [defaultLocale];
  }

  if (isDemoApiKey(apiKey)) {
    return ensureBaseLocaleAccepted(defaultLocale, [buildDemoLocale(defaultLocale)]);
  }

  try {
    const data = await fetchConfig(options);
    const fetchedLocales = parseLocalesFromApiResponse(data);
    const locales = ensureBaseLocaleAccepted(defaultLocale, fetchedLocales);

    return locales;
  } catch (error) {
    console.error('[18ways] Failed to load accepted locales:', error);
    return [defaultLocale];
  }
};

export const getWindowTranslationFallbackConfig = (): TranslationFallbackConfig | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const windowStoreConfig = window.__18WAYS_TRANSLATION_STORE__?.config;
  if (!windowStoreConfig?.translationFallback) {
    return null;
  }

  const normalizedConfig = normalizeTranslationFallbackConfig(
    windowStoreConfig.translationFallback
  );
  const hasExplicitAcceptedLocales =
    Array.isArray(windowStoreConfig.acceptedLocales) &&
    windowStoreConfig.acceptedLocales.length > 0;
  const hasExplicitFallbackConfig =
    normalizedConfig.default !== DEFAULT_TRANSLATION_FALLBACK_CONFIG.default ||
    normalizedConfig.overrides.length > 0;

  return hasExplicitAcceptedLocales || hasExplicitFallbackConfig ? normalizedConfig : null;
};

const getDefaultWindowTranslationStorePayload = (): ResolvedTranslationStoreHydrationPayload => ({
  translations: {},
  config: {
    acceptedLocales: [],
    translationFallback: DEFAULT_TRANSLATION_FALLBACK_CONFIG,
  },
});

export const mergeTranslationStoreHydrationPayload = (
  target: TranslationStoreHydrationPayload,
  input: TranslationStoreHydrationPayload | null | undefined
): ResolvedTranslationStoreHydrationPayload => {
  const translationsTarget =
    target.translations && typeof target.translations === 'object' ? target.translations : {};
  const mergedAcceptedLocales = Array.isArray(input?.config?.acceptedLocales)
    ? normalizeAcceptedLocaleList(input?.config?.acceptedLocales || [])
    : normalizeAcceptedLocaleList(target.config?.acceptedLocales || []);
  const mergedTranslationFallback = input?.config?.translationFallback
    ? normalizeTranslationFallbackConfig(input.config.translationFallback)
    : normalizeTranslationFallbackConfig(target.config?.translationFallback);

  if (input?.translations && typeof input.translations === 'object') {
    deepMerge(translationsTarget as Record<string, any>, input.translations as Record<string, any>);
  }

  target.translations = translationsTarget;
  target.config = {
    acceptedLocales: mergedAcceptedLocales,
    translationFallback: mergedTranslationFallback,
  };

  return target as ResolvedTranslationStoreHydrationPayload;
};

export const getWindowTranslationStoreHydrationPayload =
  (): ResolvedTranslationStoreHydrationPayload | null => {
    if (typeof window === 'undefined') {
      return null;
    }

    const target = window.__18WAYS_TRANSLATION_STORE__ || getDefaultWindowTranslationStorePayload();
    const mergedPayload = mergeTranslationStoreHydrationPayload(target, undefined);
    window.__18WAYS_TRANSLATION_STORE__ = mergedPayload;
    return mergedPayload;
  };

export const mergeWindowTranslationStoreHydrationPayload = (
  input: TranslationStoreHydrationPayload | null | undefined
): ResolvedTranslationStoreHydrationPayload | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const target =
    getWindowTranslationStoreHydrationPayload() || getDefaultWindowTranslationStorePayload();
  const mergedPayload = mergeTranslationStoreHydrationPayload(target, input);
  window.__18WAYS_TRANSLATION_STORE__ = mergedPayload;
  return mergedPayload;
};

export const getInMemoryTranslations = () => {
  if (typeof window !== 'undefined') {
    const payload = getWindowTranslationStoreHydrationPayload();
    return payload?.translations || {};
  }

  if (!serverCache) {
    serverCache = {};
  }
  return serverCache;
};

export const resetServerInMemoryTranslations = () => {
  if (typeof window === 'undefined') {
    serverCache = {};
  }
};

/** @internal Test helper for resetting module-level request config state. */
export const _reset18waysRequestStateForTests = (): void => {
  apiKey = undefined;
  configuredBaseLocale = undefined;
  apiUrl = undefined;
  customFetcher = undefined;
  customRequestInitDecorator = undefined;
  cacheTtlSeconds = DEFAULT_CACHE_TTL_SECONDS;
};

export const inMemoryErrorCache: { [key: string]: any } = {};

export const init = (keyOrOptions: string | InitOptions, rawOptions?: InitOptions): void => {
  const options =
    typeof keyOrOptions === 'string' ? { key: keyOrOptions, ...(rawOptions || {}) } : keyOrOptions;

  if (typeof options.key === 'string' && options.key.trim()) {
    apiKey = options.key.trim();
  } else {
    throw new Error('Cannot init without an API key');
  }

  configuredBaseLocale = canonicalizeLocale(options.baseLocale || '') || undefined;
  apiUrl = options.apiUrl;
  customFetcher = options.fetcher;
  customRequestInitDecorator = options._requestInitDecorator;

  if (
    typeof options.cacheTtlSeconds === 'number' &&
    Number.isFinite(options.cacheTtlSeconds) &&
    options.cacheTtlSeconds >= 0
  ) {
    cacheTtlSeconds = Math.floor(options.cacheTtlSeconds);
  } else {
    cacheTtlSeconds = DEFAULT_CACHE_TTL_SECONDS;
  }
};

const fetchX = async <T>({
  url,
  method,
  payload,
  queryParams,
  requestOptions,
  onError,
}: FetchXOptions<T>): Promise<T> => {
  if (!apiKey) {
    throw new Error('API key is not set');
  }

  try {
    const requestUrl = new URL(joinApiBaseAndPath(resolveApiBase(apiUrl), url));
    const fetchFn = customFetcher || fetch;
    const resolvedOrigin =
      typeof window === 'undefined' && requestOptions?.origin
        ? normalizeOrigin(requestOptions.origin)
        : null;

    Object.entries(queryParams || {}).forEach(([key, value]) => {
      if (value == null) {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((entry) => {
          requestUrl.searchParams.append(key, String(entry));
        });
        return;
      }

      requestUrl.searchParams.set(key, String(value));
    });

    const requestHeaders: Record<string, string> = {
      'x-api-key': apiKey,
    };

    if (payload) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    // Server-side requests do not automatically send browser Origin.
    if (resolvedOrigin) {
      requestHeaders.origin = resolvedOrigin;
    }

    const requestInit: _RequestInitLike = {
      method,
      headers: requestHeaders,
      body: payload ? JSON.stringify(payload) : undefined,
    };

    if (method === 'GET') {
      requestInit.cache = cacheTtlSeconds === 0 ? 'no-store' : 'force-cache';
    }

    const finalRequestInit = customRequestInitDecorator
      ? customRequestInitDecorator({
          url: requestUrl.toString(),
          method,
          requestInit,
          cacheTtlSeconds,
        })
      : requestInit;

    const result = await fetchFn(requestUrl.toString(), finalRequestInit as RequestInit);

    if (!result.ok) {
      let errorBody;
      try {
        errorBody = await result.text();
      } catch {
        errorBody = '';
      }
      throw new Error(
        `Failed to fetch: ${requestUrl.toString()} ${result.status} ${result.statusText} ${errorBody.slice(0, 200)}`
      );
    }

    try {
      return await result.json();
    } catch {
      // If JSON parsing fails, treat it as an error
      throw new Error('Invalid JSON response');
    }
  } catch (e) {
    // Handle all errors (network failures, aborts, JSON parse errors, etc.)
    return onError(e as Error);
  }
};

export const fetchTranslations = async (
  toTranslate: InProgressTranslation[],
  options?: FetchRequestOptions
): Promise<FetchTranslationsResult> => {
  if (isDemoApiKey(apiKey)) {
    const result = createDemoTranslationResult(toTranslate);
    emitRuntimeNetworkEvent({ type: 'translate', request: toTranslate, result });
    return result;
  }

  const result = await fetchX<FetchTranslationsResult>({
    url: '/translate',
    method: 'POST',
    payload: { payload: toTranslate },
    requestOptions: options,
    onError: (e) => {
      console.error(e);
      return {
        data: [],
        errors: toTranslate.map((entry) => ({
          locale: entry.targetLocale,
          key: entry.key,
          textHash: entry.textHash,
          contextFingerprint: entry.contextFingerprint ?? null,
        })),
      };
    },
  });
  emitRuntimeNetworkEvent({ type: 'translate', request: toTranslate, result });
  return result;
};

export const fetchKnown = async (
  entries: KnownTranslationEntry[],
  options?: FetchRequestOptions
): Promise<FetchKnownResult | undefined> => {
  if (isDemoApiKey(apiKey)) {
    const result = {
      data: entries,
      errors: [],
    };
    emitRuntimeNetworkEvent({ type: 'known', request: entries, result });
    return result;
  }

  const sortedEntries = [...entries].sort((a, b) =>
    JSON.stringify([a.targetLocale, a.key, a.textHash, a.contextFingerprint || '']).localeCompare(
      JSON.stringify([b.targetLocale, b.key, b.textHash, b.contextFingerprint || ''])
    )
  );

  const result = await fetchX<FetchKnownResult | undefined>({
    url: '/known',
    method: 'POST',
    payload: { payload: sortedEntries },
    requestOptions: options,
    onError: (e) => {
      console.error(e);
      return undefined;
    },
  });
  emitRuntimeNetworkEvent({ type: 'known', request: entries, result });
  return result;
};

export const fetchKnownContext = async (
  targetLocale: string,
  key: string,
  options?: FetchRequestOptions
): Promise<FetchKnownContextResult | undefined> => {
  if (isDemoApiKey(apiKey)) {
    return {
      data: [],
      errors: [],
    };
  }

  return await fetchX<FetchKnownContextResult | undefined>({
    url: '/known',
    method: 'GET',
    queryParams: {
      targetLocale,
      key,
    },
    requestOptions: options,
    onError: (e) => {
      console.error(e);
      return undefined;
    },
  });
};

export const fetchSeed = async (
  keys: string[],
  targetLocale: string,
  options?: FetchRequestOptions
): Promise<FetchSeedResult> => {
  if (isDemoApiKey(apiKey)) {
    const result = {
      data: {},
      errors: [],
      usage: {
        wordsRetrieved: 0,
        translationsRetrieved: 0,
      },
    };
    emitRuntimeNetworkEvent({ type: 'seed', targetLocale, keys, result });
    return result;
  }

  const result = await fetchX<FetchSeedResult>({
    url: '/seed',
    method: 'GET',
    requestOptions: options,
    queryParams: {
      targetLocale,
      key: [...keys].sort(),
    },
    onError: (e) => {
      console.error(e);
      return {
        data: {},
        errors: [{ reason: e.message }],
      };
    },
  });
  emitRuntimeNetworkEvent({ type: 'seed', targetLocale, keys, result });
  return result;
};

export interface Language {
  code: string;
  name: string;
  nativeName?: string;
  flag?: string;
}

const fetchConfigRaw = async (options?: FetchRequestOptions): Promise<FetchConfigResult> => {
  if (!apiKey) {
    throw new Error('API key is not set');
  }

  if (isDemoApiKey(apiKey)) {
    return createDemoConfig(configuredBaseLocale || DEFAULT_LOCALE);
  }

  const data = await fetchX<FetchConfigResult>({
    url: '/config',
    method: 'GET',
    requestOptions: options,
    onError: (error) => {
      throw new Error(
        `Failed to fetch config: origin=${options?.origin || 'none'} endpoint=/api/config cause=${error.message}`
      );
    },
  });

  return {
    languages: Array.isArray(data?.languages) ? data.languages : [],
    total: typeof data?.total === 'number' ? data.total : 0,
    translationFallback: normalizeTranslationFallbackConfig(data?.translationFallback),
  };
};

export const fetchConfig = async (options?: FetchRequestOptions): Promise<FetchConfigResult> => {
  try {
    return await fetchConfigRaw(options);
  } catch (e) {
    console.error('Failed to fetch config:', e);
    return {
      languages: [],
      total: 0,
      translationFallback: DEFAULT_TRANSLATION_FALLBACK_CONFIG,
    };
  }
};

export const generateHashId = (x: any): string => generateHashIdV2(x);
