import { canonicalizeLocale, recognizeLocale } from './i18n-shared';

export const readAcceptedLocalesFromWindow = (): string[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  if (!Array.isArray(window.__18WAYS_ACCEPTED_LOCALES__)) {
    return [];
  }

  return Array.from(
    new Set(
      window.__18WAYS_ACCEPTED_LOCALES__
        .map((locale) => recognizeLocale(locale))
        .filter((locale): locale is string => Boolean(locale))
        .map((locale) => canonicalizeLocale(locale))
    )
  );
};
