import { canonicalizeLocale, normalizePathname } from './i18n-shared';

const localeSyncSkipCounts = new Map<string, number>();
const suppressedHistorySyncCounts = new Map<string, number>();

const incrementCount = (bucket: Map<string, number>, key: string): void => {
  bucket.set(key, (bucket.get(key) || 0) + 1);
};

const consumeCount = (bucket: Map<string, number>, key: string): boolean => {
  const current = bucket.get(key) || 0;
  if (current <= 0) {
    return false;
  }

  if (current === 1) {
    bucket.delete(key);
    return true;
  }

  bucket.set(key, current - 1);
  return true;
};

export const markClientLocaleSyncHandled = (locale: string): void => {
  incrementCount(localeSyncSkipCounts, canonicalizeLocale(locale));
};

export const consumeHandledClientLocaleSync = (locale: string): boolean => {
  return consumeCount(localeSyncSkipCounts, canonicalizeLocale(locale));
};

export const suppressNextClientHistorySync = (pathname: string): void => {
  incrementCount(suppressedHistorySyncCounts, normalizePathname(pathname));
};

export const consumeSuppressedClientHistorySync = (pathname: string): boolean => {
  return consumeCount(suppressedHistorySyncCounts, normalizePathname(pathname));
};
