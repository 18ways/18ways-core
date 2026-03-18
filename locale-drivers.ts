import { readCookieFromDocument, writeCookieToDocument } from './cookie-utils';
import {
  WAYS_LOCALE_COOKIE_NAME,
  canonicalizeLocale,
  findExactSupportedLocale,
  findSupportedLocale,
  recognizeLocale,
} from './i18n-shared';
import { LocaleEngine, type LocaleDriver } from './locale-engine';

export type Awaitable<T> = T | Promise<T>;

export type LocaleCookieWriteOptions = {
  maxAge?: number;
  sameSite?: 'lax';
  secure?: boolean;
  path?: string;
};

export type LocaleDriverContext = {
  pathname?: string;
  baseLocale: string;
  supportedLocales?: string[];
  acceptedLocales?: string[];
  persistLocaleCookie?: boolean;
  currentLocale?: string;
  readCookie?: (cookieName: string) => string | null | undefined;
  writeCookie?: (
    cookieName: string,
    locale: string,
    options?: LocaleCookieWriteOptions
  ) => Awaitable<void>;
  setCurrentLocale?: (locale: string) => Awaitable<void>;
  onLocaleSynced?: (locale: string) => Awaitable<void>;
  acceptLanguageHeader?: string | null;
};

const PREFERENCE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const writeLocaleCookieToDocument = (
  cookieName: string,
  locale: string,
  options?: LocaleCookieWriteOptions
): void => {
  writeCookieToDocument(cookieName, locale, options);
};

export const BaseLocaleDriver: LocaleDriver<LocaleDriverContext> = {
  name: 'base-locale',
  getLocale: (context) => context.baseLocale,
  setLocale: () => {},
  handleListeners: () => {},
};

const recognizePreferredLocales = (candidates: string[]): string[] => {
  const uniqueLocales: string[] = [];
  const seenLocales = new Set<string>();

  for (const candidate of candidates) {
    const recognized = recognizeLocale(candidate);
    if (!recognized) {
      continue;
    }

    const key = recognized.toLowerCase();
    if (seenLocales.has(key)) {
      continue;
    }

    seenLocales.add(key);
    uniqueLocales.push(recognized);
  }

  return uniqueLocales;
};

const isLanguageOnlyLocale = (locale: string): boolean => !locale.includes('-');

const normalizeAcceptedLocales = (acceptedLocales?: string[]): string[] => {
  if (!acceptedLocales?.length) {
    return [];
  }

  return Array.from(
    new Set(
      acceptedLocales
        .map((locale) => recognizeLocale(locale))
        .filter((locale): locale is string => Boolean(locale))
        .map((locale) => canonicalizeLocale(locale))
    )
  );
};

type SupportedLocalePreferenceMatch = {
  candidate: string;
  directMatches: string[];
  fallbackMatches: string[];
};

const collectSupportedLocalePreferenceMatches = (
  candidates: string[],
  supportedLocales?: string[]
): SupportedLocalePreferenceMatch[] => {
  const recognizedCandidates = recognizePreferredLocales(candidates);
  const normalizedSupportedLocales = normalizeAcceptedLocales(supportedLocales);

  return recognizedCandidates.map((candidate) => {
    if (!normalizedSupportedLocales.length) {
      return {
        candidate,
        directMatches: [candidate],
        fallbackMatches: [],
      };
    }

    if (isLanguageOnlyLocale(candidate)) {
      const directMatches = normalizedSupportedLocales.filter(
        (locale) => findSupportedLocale(candidate, [locale]) === locale
      );

      return {
        candidate,
        directMatches,
        fallbackMatches: [],
      };
    }

    const exactMatch = findExactSupportedLocale(candidate, normalizedSupportedLocales);
    const fallbackMatches = normalizedSupportedLocales.filter(
      (locale) =>
        locale.toLowerCase() !== exactMatch?.toLowerCase() &&
        findSupportedLocale(candidate, [locale]) === locale
    );

    return {
      candidate,
      directMatches: exactMatch ? [exactMatch] : [],
      fallbackMatches: exactMatch ? fallbackMatches : [...fallbackMatches],
    };
  });
};

export const rankSupportedLocalesByPreference = (
  candidates: string[],
  supportedLocales?: string[]
): string[] => {
  const rankedLocales: string[] = [];
  const seenLocales = new Set<string>();
  const addLocale = (locale: string | null) => {
    if (!locale) {
      return;
    }

    const canonical = canonicalizeLocale(locale);
    const key = canonical.toLowerCase();
    if (seenLocales.has(key)) {
      return;
    }

    seenLocales.add(key);
    rankedLocales.push(canonical);
  };

  for (const match of collectSupportedLocalePreferenceMatches(candidates, supportedLocales)) {
    for (const locale of [...match.directMatches, ...match.fallbackMatches]) {
      addLocale(locale);
    }
  }

  return rankedLocales;
};

const resolvePreferredLocaleFromCandidates = (
  candidates: string[],
  context: Pick<LocaleDriverContext, 'acceptedLocales'>
): string | null => {
  const matches = collectSupportedLocalePreferenceMatches(candidates, context.acceptedLocales);

  for (const match of matches) {
    if (match.directMatches[0]) {
      return match.directMatches[0];
    }
  }

  for (const match of matches) {
    if (match.fallbackMatches[0]) {
      return match.fallbackMatches[0];
    }
  }

  return null;
};

const readBrowserPreferredLocales = (): string[] => {
  if (typeof navigator === 'undefined') {
    return [];
  }

  return [...(navigator.languages || []), navigator.language].filter(
    (candidate): candidate is string => Boolean(candidate)
  );
};

const parseAcceptLanguageQuality = (parameters: string[]): number => {
  for (const parameter of parameters) {
    const qualityMatch = parameter.match(/^q\s*=\s*(.+)$/i);
    if (!qualityMatch) {
      continue;
    }

    const parsed = Number.parseFloat(qualityMatch[1]?.trim() || '');
    if (!Number.isFinite(parsed)) {
      return 0;
    }

    return Math.min(1, Math.max(0, parsed));
  }

  return 1;
};

export const readPreferredLocalesFromAcceptLanguageHeader = (
  header: string | null | undefined
): string[] => {
  if (!header) {
    return [];
  }

  const rankedLocales = header
    .split(',')
    .map((token, index) => ({ token: token.trim(), index }))
    .filter(({ token }) => Boolean(token))
    .flatMap(({ token, index }) => {
      const parts = token.split(';').map((part) => part.trim());
      const localeToken = parts[0];
      if (!localeToken || localeToken === '*') {
        return [];
      }

      const recognized = recognizeLocale(localeToken);
      if (!recognized) {
        return [];
      }

      const quality = parseAcceptLanguageQuality(parts.slice(1));
      if (quality <= 0) {
        return [];
      }

      return [{ locale: recognized, quality, index }];
    })
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  const uniqueLocales: string[] = [];
  const seenLocales = new Set<string>();

  for (const { locale } of rankedLocales) {
    const key = locale.toLowerCase();
    if (seenLocales.has(key)) {
      continue;
    }

    seenLocales.add(key);
    uniqueLocales.push(locale);
  }

  return uniqueLocales;
};

export const BrowserPreferenceDriver: LocaleDriver<LocaleDriverContext> = {
  name: 'browser-preference',
  getLocale: (context) => {
    const fromHeader = resolvePreferredLocaleFromCandidates(
      readPreferredLocalesFromAcceptLanguageHeader(context.acceptLanguageHeader),
      context
    );
    if (fromHeader) {
      return fromHeader;
    }

    return resolvePreferredLocaleFromCandidates(readBrowserPreferredLocales(), context);
  },
  setLocale: () => {},
  handleListeners: (context, sync) => {
    if (typeof window === 'undefined') {
      return;
    }

    let scheduledSync: number | null = null;

    const scheduleSync = (locale: string) => {
      if (scheduledSync !== null) {
        window.clearTimeout(scheduledSync);
      }

      scheduledSync = window.setTimeout(() => {
        scheduledSync = null;
        void sync(locale);
      }, 0);
    };

    const handleLanguageChange = () => {
      const locale = resolvePreferredLocaleFromCandidates(readBrowserPreferredLocales(), context);
      if (!locale) {
        return;
      }

      scheduleSync(locale);
    };

    window.addEventListener('languagechange', handleLanguageChange);

    return () => {
      window.removeEventListener('languagechange', handleLanguageChange);
      if (scheduledSync !== null) {
        window.clearTimeout(scheduledSync);
      }
    };
  },
};

export const SessionCookieDriver: LocaleDriver<LocaleDriverContext> = {
  name: 'session-cookie',
  getLocale: (context) => {
    const readCookie = context.readCookie || readCookieFromDocument;
    return recognizeLocale(readCookie(WAYS_LOCALE_COOKIE_NAME));
  },
  setLocale: async (locale, context) => {
    const tasks: Array<Promise<void>> = [];
    const writeCookie = context.writeCookie || writeLocaleCookieToDocument;
    const persistLocaleCookie = context.persistLocaleCookie !== false;
    const safeWriteCookie = (
      cookieName: string,
      cookieLocale: string,
      cookieOptions?: LocaleCookieWriteOptions
    ): Promise<void> => {
      try {
        return Promise.resolve(writeCookie(cookieName, cookieLocale, cookieOptions)).catch(
          () => undefined
        );
      } catch {
        return Promise.resolve();
      }
    };

    if (persistLocaleCookie) {
      tasks.push(
        safeWriteCookie(WAYS_LOCALE_COOKIE_NAME, locale, {
          maxAge: PREFERENCE_COOKIE_MAX_AGE_SECONDS,
          sameSite: 'lax',
          path: '/',
        })
      );
    }

    if (context.setCurrentLocale) {
      tasks.push(Promise.resolve(context.setCurrentLocale(locale)));
    }

    if (tasks.length) {
      await Promise.all(tasks);
    }
  },
  handleListeners: () => {},
};

export const createLocaleDrivers = <TContext extends LocaleDriverContext>(
  extraDrivers: LocaleDriver<TContext>[] = []
): LocaleDriver<TContext>[] => {
  return [
    SessionCookieDriver as LocaleDriver<TContext>,
    ...extraDrivers,
    BrowserPreferenceDriver as LocaleDriver<TContext>,
    BaseLocaleDriver as LocaleDriver<TContext>,
  ];
};

export const createLocaleEngine = <TContext extends LocaleDriverContext>(options: {
  baseLocale: string;
  acceptedLocales?: string[];
  extraDrivers?: LocaleDriver<TContext>[];
}): LocaleEngine<TContext> => {
  const acceptedLocales = normalizeAcceptedLocales(options.acceptedLocales);
  const normalizedBaseLocale = recognizeLocale(options.baseLocale) || 'en-GB';

  return new LocaleEngine<TContext>({
    baseLocale: normalizedBaseLocale,
    drivers: createLocaleDrivers(options.extraDrivers || []),
    normalizeLocale: (locale) => {
      const recognized = recognizeLocale(locale);
      if (!recognized) {
        return '';
      }

      if (recognized === normalizedBaseLocale) {
        return recognized;
      }

      if (!acceptedLocales.length) {
        return recognized;
      }

      return findSupportedLocale(recognized, acceptedLocales) || '';
    },
  });
};
