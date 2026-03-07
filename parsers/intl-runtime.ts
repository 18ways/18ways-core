type NumberInput = number | string;
type DateInput = Date | string | number;
type RelativeTimeUnit = Intl.RelativeTimeFormatUnit;
type DisplayNameType = Intl.DisplayNamesType;
type MoneyInput = {
  amount: number | string;
  currency: string;
  divisor?: number;
};
type MoneyFormatOptions = {
  allowFractions?: boolean;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
};

const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();
const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();
const listFormatters = new Map<string, Intl.ListFormat>();
const displayNameFormatters = new Map<string, Intl.DisplayNames>();

const canonicalizeLocale = (locale: string): string => {
  try {
    return Intl.getCanonicalLocales(locale)[0] || locale;
  } catch {
    return locale;
  }
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
};

const getFormatter = <T>(cache: Map<string, T>, key: string, create: () => T): T => {
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const value = create();
  cache.set(key, value);
  return value;
};

export const selectPluralCategory = (
  locale: string,
  value: number,
  options?: Intl.PluralRulesOptions
): Intl.LDMLPluralRule => {
  const resolvedLocale = canonicalizeLocale(locale);
  const key = `${resolvedLocale}:${stableStringify(options || {})}`;
  const formatter = getFormatter(
    pluralRules,
    key,
    () => new Intl.PluralRules(resolvedLocale, options)
  );
  return formatter.select(value);
};

export const formatNumber = (
  locale: string,
  value: NumberInput,
  options?: Intl.NumberFormatOptions
): string | null => {
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  try {
    const resolvedLocale = canonicalizeLocale(locale);
    const key = `${resolvedLocale}:${stableStringify(options || {})}`;
    const formatter = getFormatter(numberFormatters, key, () => {
      const normalized: Intl.NumberFormatOptions =
        options && options.style === 'currency' && options.currency
          ? { ...options, currency: String(options.currency).toUpperCase() }
          : options || {};
      return new Intl.NumberFormat(resolvedLocale, normalized);
    });
    return formatter.format(n);
  } catch {
    return null;
  }
};

export const formatDateTime = (
  locale: string,
  value: DateInput,
  options?: Intl.DateTimeFormatOptions
): string | null => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const resolvedLocale = canonicalizeLocale(locale);
    const key = `${resolvedLocale}:${stableStringify(options || {})}`;
    const formatter = getFormatter(
      dateTimeFormatters,
      key,
      () => new Intl.DateTimeFormat(resolvedLocale, options)
    );
    return formatter.format(d);
  } catch {
    return null;
  }
};

export const formatRelativeTime = (
  locale: string,
  value: NumberInput,
  unit: RelativeTimeUnit,
  options?: Intl.RelativeTimeFormatOptions
): string | null => {
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  try {
    const resolvedLocale = canonicalizeLocale(locale);
    const key = `${resolvedLocale}:${unit}:${stableStringify(options || {})}`;
    const formatter = getFormatter(relativeTimeFormatters, key, () => {
      return new Intl.RelativeTimeFormat(resolvedLocale, options);
    });
    return formatter.format(n, unit);
  } catch {
    return null;
  }
};

export const formatList = (
  locale: string,
  value: unknown,
  options?: Intl.ListFormatOptions
): string | null => {
  if (!Array.isArray(value)) return null;
  const list = value.map((x) => String(x));
  try {
    const resolvedLocale = canonicalizeLocale(locale);
    const key = `${resolvedLocale}:${stableStringify(options || {})}`;
    const formatter = getFormatter(
      listFormatters,
      key,
      () => new Intl.ListFormat(resolvedLocale, options)
    );
    return formatter.format(list);
  } catch {
    return null;
  }
};

export const formatDisplayName = (
  locale: string,
  value: unknown,
  type: DisplayNameType,
  options?: Intl.DisplayNamesOptions
): string | null => {
  if (value === null || value === undefined) return null;
  try {
    const resolvedLocale = canonicalizeLocale(locale);
    const key = `${resolvedLocale}:${type}:${stableStringify(options || {})}`;
    const formatter = getFormatter(displayNameFormatters, key, () => {
      return new Intl.DisplayNames(resolvedLocale, {
        ...(options || {}),
        type,
      });
    });
    return formatter.of(String(value)) || null;
  } catch {
    return null;
  }
};

export const formatMoney = (
  locale: string,
  value: unknown,
  options?: MoneyFormatOptions
): string | null => {
  if (!value || typeof value !== 'object') return null;

  const raw = value as MoneyInput;
  if (raw.amount === null || raw.amount === undefined || !raw.currency) {
    return null;
  }

  const amount = Number(raw.amount);
  if (Number.isNaN(amount)) return null;

  const divisor = raw.divisor === undefined ? 100 : Number(raw.divisor);
  if (!Number.isFinite(divisor) || divisor === 0) return null;

  const normalizedOptions: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: String(raw.currency).toUpperCase(),
  };

  if (typeof options?.minimumFractionDigits === 'number') {
    normalizedOptions.minimumFractionDigits = options.minimumFractionDigits;
  }
  if (typeof options?.maximumFractionDigits === 'number') {
    normalizedOptions.maximumFractionDigits = options.maximumFractionDigits;
  }
  if (options?.allowFractions) {
    if (normalizedOptions.minimumFractionDigits === undefined) {
      normalizedOptions.minimumFractionDigits = 2;
    }
    if (normalizedOptions.maximumFractionDigits === undefined) {
      normalizedOptions.maximumFractionDigits = 3;
    }
  }

  return formatNumber(locale, amount / divisor, normalizedOptions);
};
