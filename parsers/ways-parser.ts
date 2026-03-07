import { getPath } from '../object-utils';
import {
  formatDateTime,
  formatDisplayName,
  formatList,
  formatMoney,
  formatNumber,
  formatRelativeTime,
  selectPluralCategory,
} from './intl-runtime';

const parseLiteral = (raw: string): string | number | boolean | undefined => {
  const value = raw.trim();
  if (!value) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'undefined') return undefined;
  if (value === 'null') return undefined;
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber) && value !== '') return asNumber;
  return value;
};

const parseNamedOptions = (parts: string[]): Record<string, any> => {
  return parts.reduce<Record<string, any>>((acc, part) => {
    const trimmed = part.trim();
    if (!trimmed) return acc;
    const sepIndex = trimmed.indexOf(':');
    if (sepIndex === -1) {
      return acc;
    }
    const key = trimmed.slice(0, sepIndex).trim();
    const value = trimmed.slice(sepIndex + 1).trim();
    if (!key) return acc;
    const parsed = parseLiteral(value);
    if (parsed !== undefined) {
      acc[key] = parsed;
    }
    return acc;
  }, {});
};

const isMoneyLikeValue = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { amount?: unknown; currency?: unknown };
  return candidate.amount !== undefined && typeof candidate.currency === 'string';
};

export const formatWaysParser = (
  vars: Record<string, any> = {},
  text: string,
  locale: string
): string => {
  const splitTopLevel = (value: string, separator: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      if (ch === separator && depth === 0) {
        out.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    out.push(current.trim());
    return out;
  };

  const parseOptions = (value: string): Record<string, string> => {
    const options: Record<string, string> = {};
    let i = 0;
    while (i < value.length) {
      while (i < value.length && /[\s,]/.test(value[i])) i++;
      if (i >= value.length) break;

      let key = '';
      while (i < value.length && !/[\s{]/.test(value[i])) {
        key += value[i];
        i++;
      }
      while (i < value.length && /\s/.test(value[i])) i++;
      if (value[i] !== '{') break;

      let depth = 0;
      let body = '';
      i++;
      depth++;
      while (i < value.length && depth > 0) {
        const ch = value[i];
        if (ch === '{') {
          depth++;
          body += ch;
        } else if (ch === '}') {
          depth--;
          if (depth > 0) body += ch;
        } else {
          body += ch;
        }
        i++;
      }
      options[key] = body;
    }
    return options;
  };

  const evaluateExpression = (expression: string): string => {
    const parts = splitTopLevel(expression, ',');
    if (!parts.length) return `{${expression}}`;

    const arg = parts[0];
    if (!arg) return `{${expression}}`;

    if (parts.length === 1) {
      const val = getPath(vars, arg);
      if (val === undefined) return `{${expression}}`;

      // For bare placeholders (`{foo}`), infer common formatters from runtime value shape.
      if (val instanceof Date) {
        const formattedDate = formatDateTime(locale, val, { dateStyle: 'medium' });
        return formattedDate ?? String(val);
      }
      if (isMoneyLikeValue(val)) {
        const formattedMoney = formatMoney(locale, val);
        return formattedMoney ?? String(val);
      }

      return String(val);
    }

    const formatType = parts[1];
    if (!formatType) return `{${expression}}`;

    if (formatType === 'number') {
      const raw = getPath(vars, arg);
      const options = parseNamedOptions(parts.slice(2)) as Intl.NumberFormatOptions;
      if (!options.style && options.currency) {
        options.style = 'currency';
      }
      const formatted = formatNumber(locale, raw, options);
      return formatted ?? `{${expression}}`;
    }

    if (formatType === 'date' || formatType === 'datetime') {
      const raw = getPath(vars, arg);
      const options = parseNamedOptions(parts.slice(2)) as Intl.DateTimeFormatOptions;
      if (Object.keys(options).length === 0) {
        options.dateStyle = 'medium';
      }
      const formatted = formatDateTime(locale, raw, options);
      return formatted ?? `{${expression}}`;
    }

    if (formatType === 'relativetime') {
      const raw = getPath(vars, arg);
      const unit = parts[2]?.trim() as Intl.RelativeTimeFormatUnit | undefined;
      if (!unit) return `{${expression}}`;
      const options = parseNamedOptions(parts.slice(3)) as Intl.RelativeTimeFormatOptions;
      const formatted = formatRelativeTime(locale, raw, unit, options);
      return formatted ?? `{${expression}}`;
    }

    if (formatType === 'list') {
      const raw = getPath(vars, arg);
      const options = parseNamedOptions(parts.slice(2)) as Intl.ListFormatOptions;
      const formatted = formatList(locale, raw, options);
      return formatted ?? `{${expression}}`;
    }

    if (formatType === 'displayname') {
      const raw = getPath(vars, arg);
      const type = parts[2]?.trim() as Intl.DisplayNamesType | undefined;
      if (!type) return `{${expression}}`;
      const options = parseNamedOptions(parts.slice(3)) as Intl.DisplayNamesOptions;
      const formatted = formatDisplayName(locale, raw, type, options);
      return formatted ?? `{${expression}}`;
    }

    if (formatType === 'money') {
      const raw = getPath(vars, arg);
      const options = parseNamedOptions(parts.slice(2));
      const formatted = formatMoney(locale, raw, options);
      return formatted ?? `{${expression}}`;
    }

    if (formatType === 'plural') {
      const rawNumber = getPath(vars, arg);
      const n = Number(rawNumber);
      if (Number.isNaN(n)) return `{${expression}}`;
      const options = parseOptions(parts.slice(2).join(','));
      const exact = options[`=${n}`];
      if (exact !== undefined) return renderPattern(exact);
      try {
        const category = selectPluralCategory(locale, n);
        if (options[category] !== undefined) return renderPattern(options[category]);
      } catch {
        // Ignore locale failures and fall back to other
      }
      if (options.other !== undefined) return renderPattern(options.other);
      return `{${expression}}`;
    }

    if (formatType === 'select') {
      const options = parseOptions(parts.slice(2).join(','));
      const raw = getPath(vars, arg);
      const key = String(raw);
      if (options[key] !== undefined) return renderPattern(options[key]);
      if (options.other !== undefined) return renderPattern(options.other);
      return `{${expression}}`;
    }

    return `{${expression}}`;
  };

  const renderPattern = (pattern: string): string => {
    let out = '';
    let i = 0;
    while (i < pattern.length) {
      if (pattern[i] !== '{') {
        out += pattern[i];
        i++;
        continue;
      }
      let depth = 0;
      let expr = '';
      i++;
      depth++;
      while (i < pattern.length && depth > 0) {
        const ch = pattern[i];
        if (ch === '{') {
          depth++;
          expr += ch;
        } else if (ch === '}') {
          depth--;
          if (depth > 0) expr += ch;
        } else {
          expr += ch;
        }
        i++;
      }
      if (depth !== 0) {
        out += `{${expr}`;
        break;
      }
      out += evaluateExpression(expr.trim());
    }
    return out;
  };

  return renderPattern(text);
};
