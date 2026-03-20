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

export type WaysTextNode = {
  type: 'text';
  value: string;
};

export type WaysArgumentNode = {
  type: 'argument';
  name: string;
};

export type WaysFormatNode = {
  type: 'format';
  name: string;
  formatType: string;
  args: string[];
};

export type WaysBranchNode = {
  type: 'branch';
  name: string;
  formatType: 'plural' | 'select';
  options: Record<string, WaysNode[]>;
};

export type WaysExpressionNode = WaysArgumentNode | WaysFormatNode | WaysBranchNode;

export type WaysNode = WaysTextNode | WaysExpressionNode;

export type WaysInspection =
  | {
      valid: true;
      hasExpressions: boolean;
      structure: string;
      nodes: WaysNode[];
      error: null;
    }
  | {
      valid: false;
      hasExpressions: false;
      structure: null;
      nodes: null;
      error: string;
    };

class WaysParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaysParseError';
  }
}

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

const splitTopLevelStrict = (value: string, separator: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;

    if (depth < 0) {
      throw new WaysParseError('Unexpected closing brace in formatter expression.');
    }

    if (ch === separator && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (depth !== 0) {
    throw new WaysParseError('Unbalanced braces in formatter expression.');
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

const parseBranchOptions = (value: string): Record<string, string> => {
  const options: Record<string, string> = {};
  let i = 0;

  while (i < value.length) {
    while (i < value.length && /[\s,]/.test(value[i])) i++;
    if (i >= value.length) break;

    const keyStart = i;
    while (i < value.length && !/[\s{]/.test(value[i])) i++;
    const key = value.slice(keyStart, i).trim();
    if (!key) {
      throw new WaysParseError('Expected a plural/select branch key.');
    }

    while (i < value.length && /\s/.test(value[i])) i++;
    if (value[i] !== '{') {
      throw new WaysParseError(`Expected a body for branch "${key}".`);
    }

    i++;
    let depth = 1;
    let body = '';

    while (i < value.length && depth > 0) {
      const ch = value[i];
      if (ch === '{') {
        depth++;
        body += ch;
      } else if (ch === '}') {
        depth--;
        if (depth > 0) {
          body += ch;
        }
      } else {
        body += ch;
      }
      i++;
    }

    if (depth !== 0) {
      throw new WaysParseError(`Unclosed body for branch "${key}".`);
    }

    if (Object.prototype.hasOwnProperty.call(options, key)) {
      throw new WaysParseError(`Duplicate branch key "${key}".`);
    }

    options[key] = body;
  }

  if (Object.keys(options).length === 0) {
    throw new WaysParseError('Plural/select expressions must define at least one branch.');
  }

  return options;
};

const hasNonWhitespaceLiteral = (value: string): boolean => /\S/.test(value);

const parseWaysExpression = (expression: string): WaysExpressionNode => {
  const parts = splitTopLevelStrict(expression, ',');
  const name = parts[0]?.trim();

  if (!name) {
    throw new WaysParseError('Formatter expressions must start with a variable name.');
  }

  if (parts.length === 1) {
    return {
      type: 'argument',
      name,
    };
  }

  const formatType = parts[1]?.trim();
  if (!formatType) {
    throw new WaysParseError(`Formatter "${name}" is missing a formatter type.`);
  }

  if (formatType === 'plural' || formatType === 'select') {
    const optionBodies = parseBranchOptions(parts.slice(2).join(','));
    return {
      type: 'branch',
      name,
      formatType,
      options: Object.fromEntries(
        Object.entries(optionBodies).map(([key, body]) => [key, parseWaysMessage(body)])
      ),
    };
  }

  return {
    type: 'format',
    name,
    formatType,
    args: parts
      .slice(2)
      .map((part) => part.trim())
      .filter(Boolean),
  };
};

export const parseWaysMessage = (message: string): WaysNode[] => {
  const nodes: WaysNode[] = [];
  let textBuffer = '';
  let cursor = 0;

  const flushText = () => {
    if (!textBuffer) {
      return;
    }

    nodes.push({
      type: 'text',
      value: textBuffer,
    });
    textBuffer = '';
  };

  while (cursor < message.length) {
    const current = message[cursor];

    if (current === '}') {
      throw new WaysParseError('Unexpected closing brace in message.');
    }

    if (current !== '{') {
      textBuffer += current;
      cursor += 1;
      continue;
    }

    flushText();

    cursor += 1;
    let depth = 1;
    let expression = '';

    while (cursor < message.length && depth > 0) {
      const ch = message[cursor];
      if (ch === '{') {
        depth++;
        expression += ch;
      } else if (ch === '}') {
        depth--;
        if (depth > 0) {
          expression += ch;
        }
      } else {
        expression += ch;
      }
      cursor += 1;
    }

    if (depth !== 0) {
      throw new WaysParseError('Unclosed formatter expression in message.');
    }

    nodes.push(parseWaysExpression(expression.trim()));
  }

  flushText();

  return nodes;
};

const normalizeWaysNode = (node: WaysExpressionNode): unknown => {
  if (node.type === 'argument') {
    return {
      type: node.type,
      name: node.name,
    };
  }

  if (node.type === 'format') {
    return {
      type: node.type,
      name: node.name,
      formatType: node.formatType,
      args: node.args,
    };
  }

  return {
    type: node.type,
    name: node.name,
    formatType: node.formatType,
    options: Object.keys(node.options)
      .sort()
      .map((key) => [key, normalizeWaysMessage(node.options[key])]),
  };
};

const normalizeWaysMessage = (nodes: WaysNode[]): unknown[] =>
  nodes
    .filter((node): node is WaysExpressionNode => node.type !== 'text')
    .map(normalizeWaysNode)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

const serializeWaysMessage = (nodes: WaysNode[]): string =>
  JSON.stringify(normalizeWaysMessage(nodes));

const hasWaysExpressionNodes = (nodes: WaysNode[]): boolean =>
  nodes.some((node) => node.type !== 'text');

export const inspectWaysMessage = (text: string): WaysInspection => {
  try {
    const nodes = parseWaysMessage(text);
    return {
      valid: true,
      hasExpressions: hasWaysExpressionNodes(nodes),
      structure: serializeWaysMessage(nodes),
      nodes,
      error: null,
    };
  } catch (error) {
    return {
      valid: false,
      hasExpressions: false,
      structure: null,
      nodes: null,
      error: error instanceof Error ? error.message : 'Invalid ways formatter syntax.',
    };
  }
};

const isRuntimeOnlyWaysNode = (node: WaysNode): boolean => {
  if (node.type === 'text') {
    return !hasNonWhitespaceLiteral(node.value);
  }

  if (node.type === 'argument') {
    return true;
  }

  if (node.type === 'format') {
    if (
      node.formatType === 'number' ||
      node.formatType === 'date' ||
      node.formatType === 'datetime' ||
      node.formatType === 'list' ||
      node.formatType === 'money'
    ) {
      return true;
    }

    if (node.formatType === 'relativetime' || node.formatType === 'displayname') {
      return Boolean(node.args[0]?.trim());
    }

    return false;
  }

  return Object.values(node.options).every((optionNodes) =>
    optionNodes.every((optionNode) => isRuntimeOnlyWaysNode(optionNode))
  );
};

export const isRuntimeOnlyWaysMessage = (text: string): boolean => {
  const inspected = inspectWaysMessage(text);
  if (!inspected.valid) {
    return false;
  }

  return (
    inspected.nodes.every((node) => isRuntimeOnlyWaysNode(node)) &&
    (inspected.hasExpressions || text.trim() === '')
  );
};

export const formatWaysParser = (
  vars: Record<string, any> = {},
  text: string,
  locale: string
): string => {
  const evaluateExpression = (expression: string): string => {
    const parts = splitTopLevel(expression, ',');
    if (!parts.length) return `{${expression}}`;

    const arg = parts[0];
    if (!arg) return `{${expression}}`;

    if (parts.length === 1) {
      const val = getPath(vars, arg);
      if (val === undefined) return `{${expression}}`;

      // For bare placeholders (`{foo}`), infer common formatters from runtime value shape.
      if (typeof val === 'number') {
        const formattedNumber = formatNumber(locale, val);
        return formattedNumber ?? String(val);
      }
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

    if (formatType === 'number' || formatType === 'percent') {
      const raw = getPath(vars, arg);
      const options = parseNamedOptions(parts.slice(2)) as Intl.NumberFormatOptions;
      if (!options.style && formatType === 'percent') {
        options.style = 'percent';
      }
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
