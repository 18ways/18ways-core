import {
  canonicalizeLocale as canonicalizeLocaleBase,
  localeToFlagEmoji as localeToFlagEmojiBase,
} from './locale';

export const WAYS_LOCALE_COOKIE_NAME = '18ways-locale';
export const WAYS_SESSION_LOCALE_COOKIE_NAME = '18ways-session-locale';
export const WAYS_LOCALE_HEADER_NAME = 'x-18ways-locale';
export const WAYS_PATHNAME_HEADER_NAME = 'x-18ways-pathname';
export const WAYS_LOCALIZED_PATHNAME_HEADER_NAME = 'x-18ways-localized-pathname';

export const SUPPORTED_LOCALES = [
  'en-US',
  'en-GB',
  'es-ES',
  'es-MX',
  'fr-FR',
  'fr-CA',
  'de-DE',
  'it-IT',
  'pt-BR',
  'pt-PT',
  'nl-NL',
  'ru-RU',
  'ja-JP',
  'zh-CN',
  'zh-TW',
  'ko-KR',
  'ar-SA',
  'hi-IN',
  'bn-BD',
  'pa-IN',
  'vi-VN',
  'th-TH',
  'tr-TR',
  'pl-PL',
  'uk-UA',
  'cs-CZ',
  'sv-SE',
  'da-DK',
  'fi-FI',
  'no-NO',
  'el-GR',
  'he-IL',
  'hu-HU',
  'ro-RO',
  'id-ID',
  'ms-MY',
  'fil-PH',
  'sw-KE',
  'af-ZA',
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export type WaysPathRoutingPattern = string | RegExp;
export type WaysPathRoutingConfig = {
  include?: WaysPathRoutingPattern[];
  exclude?: WaysPathRoutingPattern[];
};

export const DEFAULT_WAYS_PATH_ROUTING: WaysPathRoutingConfig = {
  exclude: [
    '/api',
    '/trpc',
    '/dashboard',
    '/_next',
    '/favicon.ico',
    '/robots.txt',
    '/manifest.webmanifest',
  ],
};

const DEFAULT_18WAYS_API_URL =
  process.env.NEXT_PUBLIC_18WAYS_PREVIEW_API_URL ||
  process.env.NEXT_PUBLIC_18WAYS_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  '/api';

const DEFAULT_LOCALE = 'en-GB';
const ACCEPTED_LOCALES_CACHE_TTL_MS = 5 * 60 * 1000;

type AcceptedLocalesCache = {
  locales: string[];
  expiresAt: number;
  origin: string | null;
  apiKey: string | null;
};

let acceptedLocalesCache: AcceptedLocalesCache | null = null;

export const canonicalizeLocale = canonicalizeLocaleBase;
export const localeToFlagEmoji = localeToFlagEmojiBase;

export const isRtlLocale = (locale: string): boolean => {
  const language = canonicalizeLocale(locale).split('-')[0]?.toLowerCase() || '';
  return ['ar', 'fa', 'he', 'ps', 'ur'].includes(language);
};

export const localeToOpenGraphLocale = (locale: string): string =>
  canonicalizeLocale(locale).replace('-', '_');

export const normalizePathname = (pathname: string): string => {
  if (!pathname) return '/';
  if (!pathname.startsWith('/')) return `/${pathname}`;
  return pathname;
};

const escapeRegex = (value: string): string => value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');

const globToRegex = (pattern: string): RegExp => {
  const escaped = escapeRegex(pattern);
  const withWildcards = escaped.replace(/\\\*/g, '.*');
  return new RegExp(`^${withWildcards}$`);
};

const normalizePatternString = (pattern: string): string =>
  pattern === '/' ? pattern : normalizePathname(pattern).replace(/\/+$/, '');

export const pathMatchesPattern = (pathname: string, pattern: WaysPathRoutingPattern): boolean => {
  const normalizedPathname = normalizePathname(pathname);

  if (pattern instanceof RegExp) {
    return pattern.test(normalizedPathname);
  }

  const trimmed = pattern.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.includes('*')) {
    return globToRegex(trimmed).test(normalizedPathname);
  }

  const normalizedPattern = normalizePatternString(trimmed);
  if (normalizedPattern === '/') {
    return normalizedPathname === '/';
  }

  return (
    normalizedPathname === normalizedPattern ||
    normalizedPathname.startsWith(`${normalizedPattern}/`)
  );
};

export const isPathRoutingEnabled = (pathname: string, config?: WaysPathRoutingConfig): boolean => {
  const normalizedPathname = normalizePathname(pathname);
  const includePatterns = config?.include || [];
  const excludePatterns = config?.exclude || [];

  const included =
    includePatterns.length === 0 ||
    includePatterns.some((pattern) => pathMatchesPattern(normalizedPathname, pattern));
  if (!included) {
    return false;
  }

  const excluded = excludePatterns.some((pattern) =>
    pathMatchesPattern(normalizedPathname, pattern)
  );
  return !excluded;
};

export const isRecognizableLocale = (value: string | null | undefined): boolean => {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const canonical = Intl.getCanonicalLocales(trimmed)[0];
    return typeof canonical === 'string' && canonical.length > 0;
  } catch {
    return false;
  }
};

export const recognizeLocale = (value: string | null | undefined): string | null => {
  if (!isRecognizableLocale(value)) {
    return null;
  }

  const canonical = canonicalizeLocale(value || '');
  return canonical || null;
};

const normalizeOrigin = (origin: string): string => origin.replace(/\/$/, '');

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

export const joinOriginAndPathname = (origin: string, pathname: string): string => {
  const normalizedOrigin = normalizeOrigin(origin);
  const normalizedPath = normalizePathname(pathname);
  return `${normalizedOrigin}${normalizedPath}`;
};

export const buildLocalizedPathname = (pathname: string, locale: string): string => {
  const normalizedPath = normalizePathname(pathname);
  if (normalizedPath === '/') {
    return `/${locale}`;
  }

  return `/${locale}${normalizedPath}`;
};

const localeMapFromSupported = (supportedLocales: string[]): Map<string, string> => {
  const map = new Map<string, string>();
  supportedLocales.forEach((locale) => {
    const normalized = canonicalizeLocale(locale);
    map.set(normalized.toLowerCase(), normalized);
  });
  return map;
};

export const findSupportedLocale = (
  candidate: string | null | undefined,
  supportedLocales: string[]
): string | null => {
  if (!candidate) return null;

  const normalizedCandidate = canonicalizeLocale(candidate);
  if (!normalizedCandidate) return null;

  const supportedMap = localeMapFromSupported(supportedLocales);

  const exact = supportedMap.get(normalizedCandidate.toLowerCase());
  if (exact) return exact;

  const language = normalizedCandidate.split('-')[0]?.toLowerCase();
  if (!language) return null;

  for (const locale of supportedMap.values()) {
    if (locale.split('-')[0]?.toLowerCase() === language) {
      return locale;
    }
  }

  return null;
};

export const resolveLocaleFromAcceptLanguage = (
  acceptLanguageHeader: string | null,
  supportedLocales: string[],
  fallbackLocale: string
): string => {
  if (!acceptLanguageHeader) return fallbackLocale;

  const tokens = acceptLanguageHeader
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.split(';')[0]?.trim())
    .filter((token): token is string => Boolean(token));

  for (const token of tokens) {
    if (supportedLocales.length) {
      const matched = findSupportedLocale(token, supportedLocales);
      if (matched) return matched;
    }

    const recognized = recognizeLocale(token);
    if (recognized) {
      return recognized;
    }
  }

  return fallbackLocale;
};

export const extractRecognizedLocalePrefix = (
  pathname: string
): {
  locale: string | null;
  unlocalizedPathname: string;
  localizedPathname: string;
} => {
  const normalizedPathname = normalizePathname(pathname);
  const segments = normalizedPathname.split('/').filter(Boolean);
  const first = segments[0];

  if (!first) {
    return {
      locale: null,
      unlocalizedPathname: '/',
      localizedPathname: normalizedPathname,
    };
  }

  const matchedLocale = recognizeLocale(first);
  if (!matchedLocale) {
    return {
      locale: null,
      unlocalizedPathname: normalizedPathname,
      localizedPathname: normalizedPathname,
    };
  }

  const remainingSegments = segments.slice(1);
  const unlocalizedPathname =
    remainingSegments.length === 0 ? '/' : `/${remainingSegments.join('/')}`;

  return {
    locale: matchedLocale,
    unlocalizedPathname,
    localizedPathname: normalizedPathname,
  };
};

export const extractLocalePrefix = (
  pathname: string,
  supportedLocales: string[]
): {
  locale: string | null;
  unlocalizedPathname: string;
  localizedPathname: string;
} => {
  const normalizedPathname = normalizePathname(pathname);
  const segments = normalizedPathname.split('/').filter(Boolean);
  const first = segments[0];

  if (!first) {
    return {
      locale: null,
      unlocalizedPathname: '/',
      localizedPathname: normalizedPathname,
    };
  }

  const matchedLocale = findSupportedLocale(first, supportedLocales);
  if (!matchedLocale) {
    return {
      locale: null,
      unlocalizedPathname: normalizedPathname,
      localizedPathname: normalizedPathname,
    };
  }

  const remainingSegments = segments.slice(1);
  const unlocalizedPathname =
    remainingSegments.length === 0 ? '/' : `/${remainingSegments.join('/')}`;

  return {
    locale: matchedLocale,
    unlocalizedPathname,
    localizedPathname: normalizedPathname,
  };
};

export const shouldBypassLocalization = (pathname: string): boolean => {
  const normalizedPathname = normalizePathname(pathname);

  if (
    normalizedPathname.startsWith('/api') ||
    normalizedPathname.startsWith('/dashboard') ||
    normalizedPathname.startsWith('/_next') ||
    normalizedPathname.startsWith('/trpc')
  ) {
    return true;
  }

  if (
    normalizedPathname === '/favicon.ico' ||
    normalizedPathname === '/robots.txt' ||
    normalizedPathname === '/sitemap.xml' ||
    normalizedPathname === '/manifest.webmanifest'
  ) {
    return true;
  }

  const hasFileExtension = /\.[a-zA-Z0-9]+$/.test(normalizedPathname);
  if (hasFileExtension) {
    return true;
  }

  return false;
};

export const resolveOrigin = (input: {
  explicitOrigin?: string | null;
  host?: string | null;
  forwardedProto?: string | null;
}): string => {
  if (input.explicitOrigin) {
    return normalizeOrigin(input.explicitOrigin);
  }

  if (input.host) {
    const proto = input.forwardedProto || 'https';
    return `${proto}://${input.host}`;
  }

  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  }

  if (process.env.SITE_URL) {
    return normalizeOrigin(process.env.SITE_URL);
  }

  return 'http://localhost:3000';
};

const resolveApiKey = (explicitApiKey?: string): string | undefined => {
  if (typeof explicitApiKey !== 'string') {
    return undefined;
  }

  const trimmed = explicitApiKey.trim();
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

export const fetchAcceptedLocales = async (
  fallbackLocale?: string,
  options?: { forceRefresh?: boolean; origin?: string; apiKey?: string }
): Promise<string[]> => {
  const defaultLocale = canonicalizeLocale(fallbackLocale || DEFAULT_LOCALE);
  const now = Date.now();
  const requestOrigin = options?.origin ? normalizeOrigin(options.origin) : null;
  const apiKey = resolveApiKey(options?.apiKey);

  if (
    !options?.forceRefresh &&
    acceptedLocalesCache &&
    acceptedLocalesCache.expiresAt > now &&
    acceptedLocalesCache.origin === requestOrigin &&
    acceptedLocalesCache.apiKey === (apiKey || null)
  ) {
    return acceptedLocalesCache.locales;
  }

  if (!apiKey) {
    const locales = [defaultLocale];
    acceptedLocalesCache = {
      locales,
      expiresAt: now + ACCEPTED_LOCALES_CACHE_TTL_MS,
      origin: requestOrigin,
      apiKey: null,
    };
    return locales;
  }

  const endpoint = joinApiBaseAndPath(DEFAULT_18WAYS_API_URL, '/api/enabled-languages');

  try {
    const headers: Record<string, string> = {
      'x-api-key': apiKey,
    };

    if (requestOrigin) {
      headers.origin = requestOrigin;
    }

    const response = await fetch(endpoint, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(
        `Failed to fetch accepted locales: status=${response.status} origin=${requestOrigin || 'none'} endpoint=${endpoint} body=${errorBody.slice(0, 200)}`
      );
    }

    const data = await response.json();
    const fetchedLocales = parseLocalesFromApiResponse(data);

    const locales = fetchedLocales.length
      ? Array.from(new Set([defaultLocale, ...fetchedLocales]))
      : [defaultLocale];

    acceptedLocalesCache = {
      locales,
      expiresAt: now + ACCEPTED_LOCALES_CACHE_TTL_MS,
      origin: requestOrigin,
      apiKey,
    };

    return locales;
  } catch (error) {
    console.error('[18ways] Failed to load accepted locales:', error);
    const locales = [defaultLocale];
    acceptedLocalesCache = {
      locales,
      expiresAt: now + ACCEPTED_LOCALES_CACHE_TTL_MS,
      origin: requestOrigin,
      apiKey,
    };
    return locales;
  }
};
