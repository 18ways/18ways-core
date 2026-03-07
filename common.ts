import { generateHashIdV2 } from './crypto';

export interface Translations {
  // Leaf arrays store encrypted translation payload strings.
  [key: string]: string[] | Translations;
}

export type Fetcher = typeof fetch;

interface InitOptions {
  key?: string;
  apiUrl?: string;
  fetcher?: Fetcher;
  cacheTtlSeconds?: number;
  origin?: string;
}

export interface TranslationContextValue {
  name: string;
  label: string;
  treePath: string;
  filePath: string;
}

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
    // AES-encrypted translation payloads.
    translation: string[];
  }>;
  errors: Array<{ locale: string; key: string; textsHash: string }>;
}

export interface FetchSeedResult {
  data: Translations;
  errors?: Array<{ key?: string; targetLocale?: string; hash_id?: string; reason?: string }>;
  usage?: {
    wordsRetrieved: number;
    translationsRetrieved: number;
  };
}

interface FetchXOptions {
  url: string;
  method: string;
  payload?: { payload: InProgressTranslation[] } | { keys: string[]; targetLocale: string };
  onError: (error: Error) => any;
}

interface NextFetchRequestInit extends RequestInit {
  next?: {
    revalidate: number;
  };
}

const DEFAULT_18WAYS_API_URL =
  process.env.NEXT_PUBLIC_18WAYS_PREVIEW_API_URL ||
  process.env.NEXT_PUBLIC_18WAYS_API_URL ||
  '/api';

let apiKey: string | undefined;
let apiUrl: string | undefined;
let customFetcher: Fetcher | undefined;
let requestOrigin: string | undefined;
let serverCache: Translations | null = null;
const DEFAULT_REVALIDATE_SECONDS = 10 * 60;
let revalidateSeconds = DEFAULT_REVALIDATE_SECONDS;

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

  if (options.key) {
    apiKey = options.key;
  } else {
    throw new Error('Cannot init without an API key');
  }

  if (options.apiUrl) {
    apiUrl = options.apiUrl;
  }

  if (options.fetcher) {
    customFetcher = options.fetcher;
  }

  requestOrigin = options.origin;

  if (
    typeof options.cacheTtlSeconds === 'number' &&
    Number.isFinite(options.cacheTtlSeconds) &&
    options.cacheTtlSeconds >= 0
  ) {
    revalidateSeconds = Math.floor(options.cacheTtlSeconds);
  } else {
    revalidateSeconds = DEFAULT_REVALIDATE_SECONDS;
  }
};

const fetchX = async <T>({ url, method, payload, onError }: FetchXOptions): Promise<T> => {
  if (!apiKey) {
    throw new Error('API key is not set');
  }

  try {
    const effectiveApiUrl = (apiUrl || DEFAULT_18WAYS_API_URL).replace(/\/$/, '');
    const isApiPrefixedPath = url.startsWith('/api/');
    const requestUrl = isApiPrefixedPath
      ? `${effectiveApiUrl}${effectiveApiUrl.endsWith('/api') ? url.slice(4) : url}`
      : `${effectiveApiUrl}${url}`;
    const fetchFn = customFetcher || fetch;
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    };

    // Server-side requests do not automatically send browser Origin.
    if (typeof window === 'undefined' && requestOrigin) {
      requestHeaders.origin = requestOrigin;
    }

    const requestInit: NextFetchRequestInit = {
      method,
      headers: requestHeaders,
      body: payload ? JSON.stringify(payload) : undefined,
    };

    // Next.js data cache uses `next.revalidate` on server-side fetch calls.
    if (typeof window === 'undefined' && method === 'GET') {
      requestInit.cache = 'force-cache';
      requestInit.next = { revalidate: revalidateSeconds };
    }

    const result = await fetchFn(requestUrl, requestInit);

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
        errors: toTranslate,
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

export interface FetchEnabledLanguagesResult {
  languages: Language[];
  total: number;
}

export const fetchEnabledLanguages = async (): Promise<FetchEnabledLanguagesResult> => {
  return fetchX<FetchEnabledLanguagesResult>({
    url: '/api/enabled-languages',
    method: 'GET',
    payload: undefined,
    onError: (e) => {
      console.error('Failed to fetch enabled languages:', e);
      // Return empty array on error - components should handle this gracefully
      return {
        languages: [],
        total: 0,
      };
    },
  });
};

export const generateHashId = (x: any): string => generateHashIdV2(x);
