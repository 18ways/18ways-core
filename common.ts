import { generateHashIdV2 } from './crypto';
import { canonicalizeLocale } from './i18n-shared';
import {
  isRichTextMarkup,
  mapRichTextTextNodes,
  parseRichTextSourceMarkup,
  serializeRichTextToMarkup,
} from './rich-text';

export interface Translations {
  // Leaf arrays store encrypted translation payload strings.
  [key: string]: string[] | Translations;
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
  apiUrl?: string;
  fetcher?: Fetcher;
  cacheTtlSeconds?: number;
  origin?: string;
  /** @internal Adapter-only fetch init hook. */
  _requestInitDecorator?: _RequestInitDecorator;
}

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
  textsHash: string;
  baseLocale?: string;
  targetLocale: string;
  texts: string[];
  contextFingerprint?: string;
  contextMetadata?: TranslationContextValue;
}

export interface FetchTranslationsResult {
  data: Array<{
    locale: string;
    key: string;
    textsHash: string;
    translationId: string;
    contextFingerprint?: string | null;
    // AES-encrypted translation payloads.
    translation: string[];
  }>;
  errors: Array<{
    locale: string;
    key: string;
    textsHash: string;
    contextFingerprint?: string | null;
  }>;
}

export interface FetchSeedResult {
  data: Translations;
  errors?: Array<{ key?: string; targetLocale?: string; hash_id?: string; reason?: string }>;
  usage?: {
    wordsRetrieved: number;
    translationsRetrieved: number;
  };
}

export interface FetchConfigResult {
  languages: Language[];
  total: number;
  translationFallback: TranslationFallbackConfig;
}

interface FetchXOptions {
  url: string;
  method: string;
  payload?: { payload: InProgressTranslation[] } | { keys: string[]; targetLocale: string };
  onError: (error: Error) => any;
}

const DEFAULT_18WAYS_API_URL = 'https://internal.18ways.com/api';
const DEFAULT_LOCALE = 'en-GB';
const DEFAULT_ORIGIN = 'http://localhost:3000';
const DEFAULT_ACCEPTED_LOCALES_CACHE_TTL_SECONDS = 60;
const PLACEHOLDER_API_KEY = 'YOUR_18WAYS_PUBLIC_API_KEY';

let apiKey: string | undefined;
let apiUrl: string | undefined;
let customFetcher: Fetcher | undefined;
let requestOrigin: string | undefined;
let customRequestInitDecorator: _RequestInitDecorator | undefined;
let serverCache: Translations | null = null;
const DEFAULT_CACHE_TTL_SECONDS = 10 * 60;
let cacheTtlSeconds = DEFAULT_CACHE_TTL_SECONDS;
let hasWarnedAboutPlaceholderApiKey = false;

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

const warnIfPlaceholderApiKey = (candidate?: string): void => {
  if (!candidate || hasWarnedAboutPlaceholderApiKey) {
    return;
  }

  if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
    if (candidate === PLACEHOLDER_API_KEY) {
      hasWarnedAboutPlaceholderApiKey = true;
      console.error('[18ways] Please specify your actual API key, not the placeholder value');
    }
  }
};

const resolveApiKey = (explicitApiKey?: string): string | undefined => {
  if (typeof explicitApiKey !== 'string') {
    return undefined;
  }

  const trimmed = explicitApiKey.trim();
  warnIfPlaceholderApiKey(trimmed);
  return trimmed ? trimmed : undefined;
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

export const buildTranslationFallbackValues = (
  fallbackMode: TranslationFallbackMode,
  sourceValues: string[],
  key: string
): string[] => {
  const richSourceValue =
    sourceValues.length === 1 && isRichTextMarkup(sourceValues[0])
      ? parseRichTextSourceMarkup(sourceValues[0]).value
      : null;

  if (richSourceValue) {
    if (fallbackMode === 'blank') {
      return [serializeRichTextToMarkup(mapRichTextTextNodes(richSourceValue, () => '').nodes)];
    }
    if (fallbackMode === 'key') {
      return [serializeRichTextToMarkup(mapRichTextTextNodes(richSourceValue, () => key).nodes)];
    }
    return sourceValues;
  }

  if (fallbackMode === 'blank') {
    return sourceValues.map(() => '');
  }
  if (fallbackMode === 'key') {
    return sourceValues.map(() => key);
  }
  return sourceValues;
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
  options?: {
    forceRefresh?: boolean;
    origin?: string;
    apiKey?: string;
    apiUrl?: string;
    fetcher?: Fetcher;
    cacheTtlSeconds?: number;
    /** @internal Adapter-only fetch init hook. */
    _requestInitDecorator?: _RequestInitDecorator;
  }
): Promise<string[]> => {
  const defaultLocale = canonicalizeLocale(fallbackLocale || DEFAULT_LOCALE);
  const acceptedLocalesApiKey = resolveApiKey(options?.apiKey || apiKey);
  const acceptedLocalesCacheTtlSeconds =
    typeof options?.cacheTtlSeconds === 'number' &&
    Number.isFinite(options.cacheTtlSeconds) &&
    options.cacheTtlSeconds >= 0
      ? Math.floor(options.cacheTtlSeconds)
      : DEFAULT_ACCEPTED_LOCALES_CACHE_TTL_SECONDS;

  if (!acceptedLocalesApiKey) {
    return [defaultLocale];
  }

  try {
    const data = await fetchConfig({
      forceRefresh: options?.forceRefresh,
      origin: options?.origin,
      apiKey: acceptedLocalesApiKey,
      apiUrl: options?.apiUrl,
      fetcher: options?.fetcher,
      cacheTtlSeconds: acceptedLocalesCacheTtlSeconds,
      _requestInitDecorator: options?._requestInitDecorator,
    });
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

  return window.__18WAYS_TRANSLATION_FALLBACK_CONFIG__
    ? normalizeTranslationFallbackConfig(window.__18WAYS_TRANSLATION_FALLBACK_CONFIG__)
    : null;
};

export const getInMemoryTranslations = () => {
  if (typeof window !== 'undefined') {
    if (!window.__18WAYS_IN_MEMORY_TRANSLATIONS__) {
      window.__18WAYS_IN_MEMORY_TRANSLATIONS__ = {};
    }
    return window.__18WAYS_IN_MEMORY_TRANSLATIONS__;
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

export const inMemoryErrorCache: { [key: string]: any } = {};

export const init = (keyOrOptions: string | InitOptions, rawOptions?: InitOptions): void => {
  const options =
    typeof keyOrOptions === 'string' ? { key: keyOrOptions, ...(rawOptions || {}) } : keyOrOptions;
  const resolvedApiKey = resolveApiKey(options.key);

  if (resolvedApiKey) {
    apiKey = resolvedApiKey;
  } else {
    throw new Error('Cannot init without an API key');
  }

  apiUrl = options.apiUrl;
  customFetcher = options.fetcher;
  requestOrigin = options.origin;
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

const fetchX = async <T>({ url, method, payload, onError }: FetchXOptions): Promise<T> => {
  if (!apiKey) {
    throw new Error('API key is not set');
  }

  try {
    const requestUrl = joinApiBaseAndPath(resolveApiBase(apiUrl), url);
    const fetchFn = customFetcher || fetch;
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    };

    // Server-side requests do not automatically send browser Origin.
    if (typeof window === 'undefined' && requestOrigin) {
      requestHeaders.origin = requestOrigin;
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
          url: requestUrl,
          method,
          requestInit,
          cacheTtlSeconds,
        })
      : requestInit;

    const result = await fetchFn(requestUrl, finalRequestInit as RequestInit);

    if (!result.ok) {
      // Try to parse error response, but don't fail if it's not JSON
      let errorBody;
      try {
        errorBody = await result.text();
      } catch {
        errorBody = '';
      }
      throw new Error(`Failed to fetch: ${requestUrl} ${result.status} ${result.statusText}`);
    }

    try {
      return await result.json();
    } catch (jsonError) {
      // If JSON parsing fails, treat it as an error
      throw new Error('Invalid JSON response');
    }
  } catch (e) {
    // Handle all errors (network failures, aborts, JSON parse errors, etc.)
    return onError(e as Error);
  }
};

export const fetchTranslations = async (
  toTranslate: InProgressTranslation[]
): Promise<FetchTranslationsResult> => {
  return fetchX<FetchTranslationsResult>({
    url: '/translate',
    method: 'POST',
    payload: { payload: toTranslate },
    onError: (e) => {
      console.error(e);
      return {
        data: [],
        errors: toTranslate.map((entry) => ({
          locale: entry.targetLocale,
          key: entry.key,
          textsHash: entry.textsHash,
          contextFingerprint: entry.contextFingerprint ?? null,
        })),
      };
    },
  });
};

export const fetchSeed = async (keys: string[], targetLocale: string): Promise<FetchSeedResult> => {
  return fetchX<FetchSeedResult>({
    url: '/seed',
    method: 'POST',
    payload: { keys, targetLocale },
    onError: (e) => {
      console.error(e);
      return {
        data: {},
        errors: [{ reason: e.message }],
      };
    },
  });
};

export interface Language {
  code: string;
  name: string;
  nativeName?: string;
  flag?: string;
}

const fetchConfigRaw = async (options?: {
  forceRefresh?: boolean;
  origin?: string;
  apiKey?: string;
  apiUrl?: string;
  fetcher?: Fetcher;
  cacheTtlSeconds?: number;
  _requestInitDecorator?: _RequestInitDecorator;
}): Promise<FetchConfigResult> => {
  const configApiKey = resolveApiKey(options?.apiKey || apiKey);
  if (!configApiKey) {
    throw new Error('API key is not set');
  }

  const resolvedRequestOrigin = options?.origin
    ? normalizeOrigin(options.origin)
    : typeof window === 'undefined' && requestOrigin
      ? requestOrigin
      : null;
  const resolvedCacheTtlSeconds =
    typeof options?.cacheTtlSeconds === 'number' &&
    Number.isFinite(options.cacheTtlSeconds) &&
    options.cacheTtlSeconds >= 0
      ? Math.floor(options.cacheTtlSeconds)
      : cacheTtlSeconds;
  const endpoint = joinApiBaseAndPath(resolveApiBase(options?.apiUrl || apiUrl), '/api/config');
  const headers: Record<string, string> = {
    'x-api-key': configApiKey,
  };

  if (resolvedRequestOrigin) {
    headers.origin = resolvedRequestOrigin;
  }

  const requestInit: _RequestInitLike =
    options?.forceRefresh || resolvedCacheTtlSeconds === 0
      ? {
          method: 'GET',
          headers,
          cache: 'no-store',
        }
      : {
          method: 'GET',
          headers,
          cache: 'force-cache',
        };

  const decorator = options?._requestInitDecorator || customRequestInitDecorator;
  const finalRequestInit = decorator
    ? decorator({
        url: endpoint,
        method: 'GET',
        requestInit,
        cacheTtlSeconds: resolvedCacheTtlSeconds,
      })
    : requestInit;

  const response = await (options?.fetcher || customFetcher || fetch)(
    endpoint,
    finalRequestInit as RequestInit
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(
      `Failed to fetch config: status=${response.status} origin=${resolvedRequestOrigin || 'none'} endpoint=${endpoint} body=${errorBody.slice(0, 200)}`
    );
  }

  const data = await response.json();

  return {
    languages: Array.isArray(data?.languages) ? data.languages : [],
    total: typeof data?.total === 'number' ? data.total : 0,
    translationFallback: normalizeTranslationFallbackConfig(data?.translationFallback),
  };
};

export const fetchConfig = async (options?: {
  forceRefresh?: boolean;
  origin?: string;
  apiKey?: string;
  apiUrl?: string;
  fetcher?: Fetcher;
  cacheTtlSeconds?: number;
  _requestInitDecorator?: _RequestInitDecorator;
}): Promise<FetchConfigResult> => {
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
