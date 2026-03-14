import type { WaysPathRoutingConfig } from './i18n-shared';
import {
  buildLocalizedPathname,
  extractLocalePrefix,
  extractRecognizedLocalePrefix,
  findSupportedLocale,
  isPathRoutingEnabled,
  normalizePathname,
} from './i18n-shared';
import { consumeSuppressedClientHistorySync } from './client-locale-coordination';
import {
  createLocaleDrivers,
  createLocaleEngine,
  type Awaitable,
  type LocaleDriverContext,
} from './locale-drivers';
import type { LocaleDriver } from './locale-engine';

export type PathLocaleResolution = {
  unlocalizedPathname: string;
  localizedPathname: string;
  rewritePathname?: string;
  redirectPathname?: string;
};

export type PathLocaleDriverContext = LocaleDriverContext & {
  pathname: string;
  pathRouting?: WaysPathRoutingConfig;
  navigateToPathname?: (pathname: string) => Awaitable<void>;
  onPathLocaleResolution?: (resolution: PathLocaleResolution) => Awaitable<void>;
};

const extractPathLocaleInfo = (pathname: string, context: PathLocaleDriverContext) => {
  const normalizedPathname = normalizePathname(pathname);
  const supportedLocales = context.supportedLocales?.length
    ? context.supportedLocales
    : context.acceptedLocales;
  if (supportedLocales?.length) {
    return extractLocalePrefix(normalizedPathname, supportedLocales);
  }

  return extractRecognizedLocalePrefix(normalizedPathname);
};

const resolveAcceptedPathLocale = (
  locale: string | null,
  context: PathLocaleDriverContext
): string | null => {
  if (!locale) {
    return null;
  }

  if (!context.acceptedLocales?.length) {
    return locale;
  }

  return findSupportedLocale(locale, context.acceptedLocales);
};

export const PathLocaleDriver: LocaleDriver<PathLocaleDriverContext> = {
  name: 'path',
  getLocale: (context) => {
    if (!context.pathRouting) {
      return null;
    }

    const pathInfo = extractPathLocaleInfo(context.pathname, context);
    if (!isPathRoutingEnabled(pathInfo.unlocalizedPathname, context.pathRouting)) {
      return null;
    }

    return resolveAcceptedPathLocale(pathInfo.locale, context);
  },
  setLocale: async (locale, context) => {
    if (!context.pathRouting) {
      return;
    }

    const normalizedPathname = normalizePathname(context.pathname);
    const pathInfo = extractPathLocaleInfo(normalizedPathname, context);
    if (!isPathRoutingEnabled(pathInfo.unlocalizedPathname, context.pathRouting)) {
      return;
    }

    const unlocalizedPathname = normalizePathname(pathInfo.unlocalizedPathname);
    const localizedPathname = normalizePathname(
      buildLocalizedPathname(unlocalizedPathname, locale)
    );
    const tasks: Array<Promise<void>> = [];

    if (context.onPathLocaleResolution) {
      const resolution: PathLocaleResolution = {
        unlocalizedPathname,
        localizedPathname,
      };

      if (pathInfo.locale === locale) {
        if (normalizedPathname !== unlocalizedPathname) {
          resolution.rewritePathname = unlocalizedPathname;
        }
      } else {
        resolution.redirectPathname = localizedPathname;
      }

      tasks.push(Promise.resolve(context.onPathLocaleResolution(resolution)));
    }

    if (context.navigateToPathname && localizedPathname !== normalizedPathname) {
      tasks.push(Promise.resolve(context.navigateToPathname(localizedPathname)));
    }

    if (tasks.length) {
      await Promise.all(tasks);
    }
  },
  handleListeners: (context, sync) => {
    if (typeof window === 'undefined' || !context.pathRouting) {
      return;
    }

    let queuedLocale: string | null = null;
    let scheduledSync: number | null = null;

    const scheduleSync = (locale: string) => {
      queuedLocale = locale;
      if (scheduledSync !== null) {
        return;
      }

      scheduledSync = window.setTimeout(() => {
        scheduledSync = null;
        const nextLocale = queuedLocale;
        queuedLocale = null;
        if (!nextLocale) {
          return;
        }

        void sync(nextLocale);
      }, 0);
    };

    const maybeSyncFromPathname = (pathname: string) => {
      const normalizedPathname = normalizePathname(pathname);
      const pathInfo = extractPathLocaleInfo(normalizedPathname, context);
      if (!isPathRoutingEnabled(pathInfo.unlocalizedPathname, context.pathRouting)) {
        return;
      }

      if (!pathInfo.locale) {
        return;
      }

      scheduleSync(pathInfo.locale);
    };

    const handlePopState = () => {
      maybeSyncFromPathname(window.location.pathname || '/');
    };

    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);

    window.history.pushState = function pushState(...args) {
      originalPushState(...args);
      const pathname = window.location.pathname || '/';
      if (consumeSuppressedClientHistorySync(pathname)) {
        return;
      }
      maybeSyncFromPathname(pathname);
    };

    window.history.replaceState = function replaceState(...args) {
      originalReplaceState(...args);
      const pathname = window.location.pathname || '/';
      if (consumeSuppressedClientHistorySync(pathname)) {
        return;
      }
      maybeSyncFromPathname(pathname);
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      if (scheduledSync !== null) {
        window.clearTimeout(scheduledSync);
      }
    };
  },
};

export const createPathLocaleDrivers = <
  TContext extends PathLocaleDriverContext,
>(): LocaleDriver<TContext>[] => {
  return createLocaleDrivers([PathLocaleDriver as LocaleDriver<TContext>]);
};

export const createPathLocaleEngine = <TContext extends PathLocaleDriverContext>(options: {
  baseLocale: string;
  acceptedLocales?: string[];
}) => {
  return createLocaleEngine<TContext>({
    baseLocale: options.baseLocale,
    acceptedLocales: options.acceptedLocales,
    extraDrivers: [PathLocaleDriver as LocaleDriver<TContext>],
  });
};
