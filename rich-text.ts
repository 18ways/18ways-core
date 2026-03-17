export interface RichTextTextNode {
  type: 'text';
  value: string;
}

export interface RichTextSlotNode {
  type: 'slot';
  name: string;
  children: RichTextNode[];
}

export type RichTextNode = RichTextTextNode | RichTextSlotNode;

export interface RichTextValue {
  kind: 'rich';
  nodes: RichTextNode[];
}

const TEXT_NODE_TYPE = 'text';
const SLOT_NODE_TYPE = 'slot';
const RICH_VALUE_KIND = 'rich';
const TAG_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const LITERAL_ANGLE_BRACKET_ERROR =
  'Literal angle brackets must be escaped as &lt; and &gt; in rich text.';

const escapeMarkupText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const decodeMarkupText = (value: string): string =>
  value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const normalizeNodes = (nodes: RichTextNode[]): RichTextNode[] => {
  const normalized: RichTextNode[] = [];

  nodes.forEach((node) => {
    if (node.type === TEXT_NODE_TYPE) {
      if (!node.value) {
        return;
      }

      const previous = normalized[normalized.length - 1];
      if (previous?.type === TEXT_NODE_TYPE) {
        previous.value += node.value;
        return;
      }
    }

    normalized.push(node);
  });

  return normalized;
};

export const isRichTextNode = (value: unknown): value is RichTextNode => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const node = value as Partial<RichTextNode>;
  if (node.type === TEXT_NODE_TYPE) {
    return typeof (node as RichTextTextNode).value === 'string';
  }

  if (node.type === SLOT_NODE_TYPE) {
    return (
      typeof (node as RichTextSlotNode).name === 'string' &&
      Array.isArray((node as RichTextSlotNode).children) &&
      (node as RichTextSlotNode).children.every(isRichTextNode)
    );
  }

  return false;
};

export const isRichTextValue = (value: unknown): value is RichTextValue => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const richValue = value as Partial<RichTextValue>;
  return (
    richValue.kind === RICH_VALUE_KIND &&
    Array.isArray(richValue.nodes) &&
    richValue.nodes.every(isRichTextNode)
  );
};

export const parseTranslationText = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

export const serializeRichTextToMarkup = (nodes: RichTextNode[]): string =>
  nodes
    .map((node) => {
      if (node.type === TEXT_NODE_TYPE) {
        return escapeMarkupText(node.value);
      }

      if (node.children.length === 0) {
        return `<${node.name} />`;
      }

      return `<${node.name}>${serializeRichTextToMarkup(node.children)}</${node.name}>`;
    })
    .join('');

export const flattenRichTextNodes = (nodes: RichTextNode[]): string =>
  nodes
    .map((node) => {
      if (node.type === TEXT_NODE_TYPE) {
        return node.value;
      }

      return flattenRichTextNodes(node.children);
    })
    .join('');

export const mapRichTextTextNodes = (
  value: RichTextValue,
  transform: (text: string) => string
): RichTextValue => ({
  kind: RICH_VALUE_KIND,
  nodes: value.nodes.map((node) => {
    if (node.type === TEXT_NODE_TYPE) {
      return {
        type: TEXT_NODE_TYPE,
        value: transform(node.value),
      };
    }

    return {
      type: SLOT_NODE_TYPE,
      name: node.name,
      children: mapRichTextTextNodes(
        {
          kind: RICH_VALUE_KIND,
          nodes: node.children,
        },
        transform
      ).nodes,
    };
  }),
});

export const collectRichTextSlotCounts = (nodes: RichTextNode[]): Record<string, number> => {
  const counts: Record<string, number> = {};

  nodes.forEach((node) => {
    if (node.type !== SLOT_NODE_TYPE) {
      return;
    }

    counts[node.name] = (counts[node.name] || 0) + 1;
    const childCounts = collectRichTextSlotCounts(node.children);
    Object.entries(childCounts).forEach(([name, count]) => {
      counts[name] = (counts[name] || 0) + count;
    });
  });

  return counts;
};

const compareSlotCounts = (
  left: Record<string, number>,
  right: Record<string, number>
): boolean => {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
};

const sortNamesByLength = (names: string[]): string[] =>
  [...names].sort((a, b) => b.length - a.length || a.localeCompare(b));

const readTag = (
  input: string,
  start: number,
  allowedSlotNames: Set<string> | null
):
  | {
      type: 'open' | 'close' | 'selfClose';
      name: string;
      length: number;
    }
  | {
      error: string;
    } => {
  if (input[start] !== '<') {
    return { error: LITERAL_ANGLE_BRACKET_ERROR };
  }

  const end = input.indexOf('>', start + 1);
  if (end === -1) {
    return { error: 'Unclosed tag in rich text markup.' };
  }

  const rawBody = input.slice(start + 1, end);
  if (!rawBody) {
    return { error: LITERAL_ANGLE_BRACKET_ERROR };
  }

  const normalizedBody = rawBody.trim();
  const isClosingTag = normalizedBody.startsWith('/');
  const isSelfClosingTag = !isClosingTag && normalizedBody.endsWith('/');
  const name = isClosingTag
    ? normalizedBody.slice(1).trim()
    : isSelfClosingTag
      ? normalizedBody.slice(0, -1).trim()
      : normalizedBody;
  if (!name || name !== name.trim() || !TAG_NAME_PATTERN.test(name)) {
    return { error: LITERAL_ANGLE_BRACKET_ERROR };
  }

  if (allowedSlotNames && !allowedSlotNames.has(name)) {
    return { error: `Unknown placeholder tag <${name}>.` };
  }

  return {
    type: isClosingTag ? 'close' : isSelfClosingTag ? 'selfClose' : 'open',
    name,
    length: end - start + 1,
  };
};

const parseRichTextMarkupInternal = (
  input: string,
  allowedSlotNames: string[] | null
): { value: RichTextValue | null; error: string | null } => {
  const sortedSlotNames = allowedSlotNames
    ? sortNamesByLength(allowedSlotNames.filter(Boolean))
    : [];
  const allowedSlotNameSet = allowedSlotNames ? new Set(sortedSlotNames) : null;
  const stack: Array<{ name: string | null; nodes: RichTextNode[] }> = [{ name: null, nodes: [] }];
  let textBuffer = '';
  let cursor = 0;

  const flushTextBuffer = () => {
    if (!textBuffer) {
      return;
    }

    stack[stack.length - 1].nodes.push({
      type: TEXT_NODE_TYPE,
      value: decodeMarkupText(textBuffer),
    });
    textBuffer = '';
  };

  while (cursor < input.length) {
    const currentChar = input[cursor];
    if (currentChar !== '<') {
      textBuffer += currentChar;
      cursor += 1;
      continue;
    }

    const tag = readTag(input, cursor, allowedSlotNameSet);
    if ('error' in tag) {
      return {
        value: null,
        error: tag.error,
      };
    }

    flushTextBuffer();

    if (tag.type === 'open') {
      stack.push({ name: tag.name, nodes: [] });
      cursor += tag.length;
      continue;
    }

    if (tag.type === 'selfClose') {
      stack[stack.length - 1].nodes.push({
        type: SLOT_NODE_TYPE,
        name: tag.name,
        children: [],
      });
      cursor += tag.length;
      continue;
    }

    const current = stack.pop();
    if (!current || current.name !== tag.name) {
      return {
        value: null,
        error: `Mismatched closing tag </${tag.name}>.`,
      };
    }

    stack[stack.length - 1].nodes.push({
      type: SLOT_NODE_TYPE,
      name: tag.name,
      children: normalizeNodes(current.nodes),
    });
    cursor += tag.length;
  }

  flushTextBuffer();

  if (stack.length !== 1) {
    const dangling = stack[stack.length - 1].name;
    return {
      value: null,
      error: dangling ? `Unclosed tag <${dangling}>.` : 'Invalid rich text markup.',
    };
  }

  return {
    value: {
      kind: RICH_VALUE_KIND,
      nodes: normalizeNodes(stack[0].nodes),
    },
    error: null,
  };
};

export const parseRichTextMarkup = (
  input: string,
  slotNames: string[]
): { value: RichTextValue | null; error: string | null } =>
  parseRichTextMarkupInternal(input, slotNames);

export const parseRichTextSourceMarkup = (
  input: string
): { value: RichTextValue | null; error: string | null } =>
  parseRichTextMarkupInternal(input, null);

export const parseRichTextMarkupAgainstSource = (
  input: string,
  source: RichTextValue | string
): { value: RichTextValue | null; error: string | null } => {
  const sourceValue = typeof source === 'string' ? parseRichTextSourceMarkup(source).value : source;
  if (!sourceValue) {
    return {
      value: null,
      error: 'Invalid source rich text markup.',
    };
  }

  const expectedCounts = collectRichTextSlotCounts(sourceValue.nodes);
  const slotNames = Object.keys(expectedCounts);
  const parsed = parseRichTextMarkup(input, slotNames);
  if (!parsed.value || parsed.error) {
    return parsed;
  }

  const actualCounts = collectRichTextSlotCounts(parsed.value.nodes);
  if (!compareSlotCounts(expectedCounts, actualCounts)) {
    return {
      value: null,
      error: 'Placeholder tags must be preserved exactly.',
    };
  }

  return parsed;
};

export const richTextMarkupToPlainText = (input: string): string => {
  const parsed = parseRichTextSourceMarkup(input);
  if (parsed.value && Object.keys(collectRichTextSlotCounts(parsed.value.nodes)).length > 0) {
    return flattenRichTextNodes(parsed.value.nodes);
  }

  return decodeMarkupText(input);
};

export const isRichTextMarkup = (input: string): boolean => {
  const parsed = parseRichTextSourceMarkup(input);
  return Boolean(
    parsed.value && Object.keys(collectRichTextSlotCounts(parsed.value.nodes)).length > 0
  );
};
