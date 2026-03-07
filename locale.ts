export const canonicalizeLocale = (locale: string): string => {
  const trimmed = locale.trim();
  if (!trimmed) {
    return '';
  }

  try {
    return Intl.getCanonicalLocales(trimmed)[0] || trimmed;
  } catch {
    return trimmed;
  }
};

export const localeToFlagEmoji = (locale: string): string | undefined => {
  const canonicalLocale = canonicalizeLocale(locale);
  const region = (() => {
    try {
      return new Intl.Locale(canonicalLocale).region || null;
    } catch {
      const segments = canonicalLocale.split('-');
      const lastSegment = segments[segments.length - 1] || '';
      return /^[a-zA-Z]{2}$/.test(lastSegment) ? lastSegment.toUpperCase() : null;
    }
  })();

  if (!region || !/^[A-Z]{2}$/.test(region)) {
    return undefined;
  }

  const REGIONAL_INDICATOR_OFFSET = 127397;
  return String.fromCodePoint(
    ...region.split('').map((char) => REGIONAL_INDICATOR_OFFSET + char.charCodeAt(0))
  );
};
