import { getWindowTranslationStoreHydrationPayload, resolveAcceptedLocales } from './common';
import { recognizeLocale } from './i18n-shared';

export const readAcceptedLocalesFromWindow = (): string[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  const hydratedAcceptedLocales =
    getWindowTranslationStoreHydrationPayload()?.config.acceptedLocales;

  if (!Array.isArray(hydratedAcceptedLocales)) {
    return [];
  }

  return resolveAcceptedLocales(
    undefined,
    hydratedAcceptedLocales
      .map((locale) => recognizeLocale(locale))
      .filter((locale): locale is string => Boolean(locale))
  );
};
