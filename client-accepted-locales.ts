import { canonicalizeLocale, recognizeLocale } from './i18n-shared';

type WaysWindowWithAcceptedLocales = Window &
  typeof globalThis & {
    __18WAYS_ACCEPTED_LOCALES__?: string[];
  };

export const readAcceptedLocalesFromWindow = (): string[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  const waysWindow = window as WaysWindowWithAcceptedLocales;
  if (!Array.isArray(waysWindow.__18WAYS_ACCEPTED_LOCALES__)) {
    return [];
  }

  return Array.from(
    new Set(
      waysWindow.__18WAYS_ACCEPTED_LOCALES__
        .map((locale) => recognizeLocale(locale))
        .filter((locale): locale is string => Boolean(locale))
        .map((locale) => canonicalizeLocale(locale))
    )
  );
};
