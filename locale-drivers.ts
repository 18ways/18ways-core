import { readCookieFromDocument, writeCookieToDocument } from './cookie-utils';
import {
  WAYS_LOCALE_COOKIE_NAME,
  canonicalizeLocale,
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

const readBrowserPreferredLocale = (): string | null => {
  if (typeof navigator === 'undefined') {
    return null;
  }

  const candidates = [...(navigator.languages || []), navigator.language].filter(Boolean);
  for (const candidate of candidates) {
    const locale = recognizeLocale(candidate);
    if (locale) {
      return locale;
    }
  }

  return null;
};

const parseAcceptLanguageLocale = (header: string | null | undefined): string | null => {
  if (!header) {
    return null;
  }

  const tokens = header
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.split(';')[0]?.trim())
    .filter((token): token is string => Boolean(token));

  for (const token of tokens) {
    const recognized = recognizeLocale(token);
    if (recognized) {
      return recognized;
    }
  }

  return null;
};

export const BrowserPreferenceDriver: LocaleDriver<LocaleDriverContext> = {
  name: 'browser-preference',
  getLocale: (context) => {
    const fromHeader = parseAcceptLanguageLocale(context.acceptLanguageHeader);
    if (fromHeader) {
      return fromHeader;
    }

    return readBrowserPreferredLocale();
  },
  setLocale: () => {},
  handleListeners: (_context, sync) => {
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
      const locale = readBrowserPreferredLocale();
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
