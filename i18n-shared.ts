import {
  canonicalizeLocale as canonicalizeLocaleBase,
  localeToFlagEmoji as localeToFlagEmojiBase,
} from './locale';

export const WAYS_LOCALE_COOKIE_NAME = '18ways_locale';

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

const AUTO_EXCLUDED_PATH_ROUTING_PATTERNS: WaysPathRoutingPattern[] = [
  /^\/_next(?:\/|$)/,
  /^\/api(?:\/|$)/,
  '/robots.txt',
  '/favicon.ico',
  '/manifest.webmanifest',
  '/site.webmanifest',
  '/sw.js',
];

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
    return normalizedPathname.startsWith('/');
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
  const explicitlyIncluded = includePatterns.some((pattern) =>
    pathMatchesPattern(normalizedPathname, pattern)
  );
  const explicitlyOverridesAutoExclude = includePatterns.some((pattern) => {
    if (typeof pattern === 'string' && normalizePatternString(pattern.trim()) === '/') {
      return false;
    }

    return pathMatchesPattern(normalizedPathname, pattern);
  });

  const included = includePatterns.length === 0 || explicitlyIncluded;
  if (!included) {
    return false;
  }

  const explicitlyExcluded = excludePatterns.some((pattern) =>
    pathMatchesPattern(normalizedPathname, pattern)
  );
  if (explicitlyExcluded) {
    return false;
  }

  if (!config) {
    return true;
  }

  const autoExcluded = AUTO_EXCLUDED_PATH_ROUTING_PATTERNS.some((pattern) =>
    pathMatchesPattern(normalizedPathname, pattern)
  );
  if (autoExcluded && !explicitlyOverridesAutoExclude) {
    return false;
  }

  return true;
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

const normalizeComparableLocale = (locale: string): string =>
  (recognizeLocale(locale) || '').toLowerCase();

const matchesLocaleSegment = (
  segment: string,
  options?: { locale?: string; acceptedLocales?: string[] }
): boolean => {
  const recognizedSegment = recognizeLocale(segment);
  if (!recognizedSegment) {
    return false;
  }

  const normalizedSegment = normalizeComparableLocale(recognizedSegment);
  if (!normalizedSegment) {
    return false;
  }

  if (options?.locale) {
    const normalizedLocale = normalizeComparableLocale(options.locale);
    if (normalizedLocale && normalizedLocale === normalizedSegment) {
      return true;
    }
  }

  if (options?.acceptedLocales?.length) {
    return options.acceptedLocales.some(
      (locale) => normalizeComparableLocale(locale) === normalizedSegment
    );
  }

  return true;
};

const normalizeOrigin = (origin: string): string => origin.replace(/\/$/, '');

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

export const stripLocalePrefix = (
  pathname: string,
  options?: { locale?: string; acceptedLocales?: string[] }
): string => {
  const normalizedPathname = normalizePathname(pathname);
  const segments = normalizedPathname.split('/').filter(Boolean);
  if (!segments.length) {
    return '/';
  }

  if (!matchesLocaleSegment(segments[0], options)) {
    return normalizedPathname;
  }

  const remainingSegments = segments.slice(1);
  return remainingSegments.length ? `/${remainingSegments.join('/')}` : '/';
};

export const localizePathname = (
  pathname: string,
  locale: string,
  options?: {
    acceptedLocales?: string[];
    currentLocale?: string;
    pathRouting?: WaysPathRoutingConfig;
  }
): string => {
  const recognizedLocale = recognizeLocale(locale);
  if (!recognizedLocale) {
    return normalizePathname(pathname);
  }

  const normalizedPathname = normalizePathname(pathname);
  const effectivePathRouting = options?.pathRouting;
  if (!effectivePathRouting) {
    return normalizedPathname;
  }

  let basePathname = normalizedPathname;

  if (options?.acceptedLocales?.length) {
    const pathInfo = extractLocalePrefix(normalizedPathname, options.acceptedLocales);
    if (pathInfo.unlocalizedPathname !== normalizedPathname) {
      basePathname = pathInfo.unlocalizedPathname;
    }
  }

  if (basePathname === normalizedPathname && options?.currentLocale) {
    basePathname = stripLocalePrefix(normalizedPathname, {
      locale: options.currentLocale,
      acceptedLocales: [options.currentLocale],
    });
  }

  if (basePathname === normalizedPathname) {
    basePathname = stripLocalePrefix(normalizedPathname, {
      locale: recognizedLocale,
      acceptedLocales: [recognizedLocale],
    });
  }

  if (!isPathRoutingEnabled(basePathname, effectivePathRouting)) {
    return basePathname;
  }

  return buildLocalizedPathname(basePathname, recognizedLocale);
};

const localeMapFromSupported = (supportedLocales: string[]): Map<string, string> => {
  const map = new Map<string, string>();
  supportedLocales.forEach((locale) => {
    const normalized = canonicalizeLocale(locale);
    map.set(normalized.toLowerCase(), normalized);
  });
  return map;
};

const getLocaleLanguage = (locale: string): string => locale.split('-')[0]?.toLowerCase() || '';

export const findExactSupportedLocale = (
  candidate: string | null | undefined,
  supportedLocales: string[]
): string | null => {
  if (!candidate) return null;

  const normalizedCandidate = canonicalizeLocale(candidate);
  if (!normalizedCandidate) return null;

  const supportedMap = localeMapFromSupported(supportedLocales);
  return supportedMap.get(normalizedCandidate.toLowerCase()) || null;
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

  const candidateLanguage = getLocaleLanguage(normalizedCandidate);
  if (!candidateLanguage) return null;

  for (const locale of supportedMap.values()) {
    if (getLocaleLanguage(locale) === candidateLanguage) {
      return locale;
    }
  }

  return null;
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
  const recognizedPrefix = extractRecognizedLocalePrefix(pathname);
  if (!recognizedPrefix.locale) {
    return recognizedPrefix;
  }

  const matchedSupportedLocale = findSupportedLocale(recognizedPrefix.locale, supportedLocales);
  if (!matchedSupportedLocale) {
    return {
      locale: null,
      unlocalizedPathname: recognizedPrefix.localizedPathname,
      localizedPathname: recognizedPrefix.localizedPathname,
    };
  }

  return {
    locale: findExactSupportedLocale(recognizedPrefix.locale, supportedLocales),
    unlocalizedPathname: recognizedPrefix.unlocalizedPathname,
    localizedPathname: recognizedPrefix.localizedPathname,
  };
};
