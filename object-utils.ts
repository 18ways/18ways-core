type PathSegment = string | number;

const isPlainObject = (value: unknown): value is Record<string, any> => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const cloneDeepValue = (value: unknown): any => {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneDeepValue(entry));
  }

  if (isPlainObject(value)) {
    const clone: Record<string, any> = {};
    Object.entries(value).forEach(([key, entryValue]) => {
      clone[key] = cloneDeepValue(entryValue);
    });
    return clone;
  }

  return value;
};

export const deepMerge = (
  target: Record<string, any>,
  ...sources: Array<Record<string, any> | undefined | null>
): Record<string, any> => {
  sources.forEach((source) => {
    if (!isPlainObject(source)) {
      return;
    }

    Object.entries(source).forEach(([key, sourceValue]) => {
      const targetValue = target[key];
      if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
        deepMerge(targetValue, sourceValue);
        return;
      }

      target[key] = cloneDeepValue(sourceValue);
    });
  });

  return target;
};

export const deepMerged = (
  ...sources: Array<Record<string, any> | undefined | null>
): Record<string, any> => {
  return deepMerge({}, ...sources);
};

const parsePath = (path: string): string[] => {
  const segments: string[] = [];
  let token = '';
  let index = 0;

  while (index < path.length) {
    const ch = path[index];

    if (ch === '.') {
      if (token.length > 0) {
        segments.push(token);
        token = '';
      }
      index += 1;
      continue;
    }

    if (ch === '[') {
      if (token.length > 0) {
        segments.push(token);
        token = '';
      }

      index += 1;
      while (index < path.length && /\s/.test(path[index])) {
        index += 1;
      }

      if (index < path.length && (path[index] === '"' || path[index] === "'")) {
        const quote = path[index];
        index += 1;
        let quotedToken = '';
        while (index < path.length) {
          const quotedChar = path[index];
          if (quotedChar === '\\' && index + 1 < path.length) {
            quotedToken += path[index + 1];
            index += 2;
            continue;
          }
          if (quotedChar === quote) {
            index += 1;
            break;
          }
          quotedToken += quotedChar;
          index += 1;
        }
        if (quotedToken.length > 0) {
          segments.push(quotedToken);
        }
      } else {
        let bracketToken = '';
        while (index < path.length && path[index] !== ']') {
          bracketToken += path[index];
          index += 1;
        }
        const trimmed = bracketToken.trim();
        if (trimmed.length > 0) {
          segments.push(trimmed);
        }
      }

      while (index < path.length && path[index] !== ']') {
        index += 1;
      }
      if (index < path.length && path[index] === ']') {
        index += 1;
      }
      continue;
    }

    token += ch;
    index += 1;
  }

  if (token.length > 0) {
    segments.push(token);
  }

  return segments;
};

export const getPath = (value: unknown, path: string | PathSegment[]): any => {
  const segments = Array.isArray(path) ? path.map(String) : parsePath(path);
  let cursor: unknown = value;

  for (const segment of segments) {
    if (cursor == null || (typeof cursor !== 'object' && typeof cursor !== 'function')) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return cursor;
};
