import { inspectWaysMessage, type WaysNode } from './parsers/ways-parser';
import {
  collectRichTextSlotCounts,
  parseRichTextMarkupAgainstSource,
  parseRichTextSourceMarkup,
} from './rich-text';

export type TranslationStructureValidationResult = {
  valid: boolean;
  errors: string[];
};

export type WaysFormatterSummary = {
  valid: boolean;
  error: string | null;
  count: number;
  variableNames: string[];
  expressionTypeCounts: {
    argument: number;
    format: number;
    branch: number;
  };
  formatTypeCounts: Record<string, number>;
  branchTypeCounts: {
    plural: number;
    select: number;
  };
  branchKeys: string[];
  structure: string | null;
};

export type RichTextTagSummary = {
  valid: boolean;
  error: string | null;
  count: number;
  names: string[];
  counts: Record<string, number>;
};

export type TranslationSourceStructure = {
  hasWaysFormatters: boolean;
  hasRichTextTags: boolean;
  waysFormatters: WaysFormatterSummary;
  richTextTags: RichTextTagSummary;
};

export type DetailedTranslationStructureValidationResult = {
  valid: boolean;
  source: TranslationSourceStructure;
  translated: TranslationSourceStructure;
  waysFormatters: TranslationStructureValidationResult;
  richTextTags: TranslationStructureValidationResult;
  errors: string[];
};

const sortStrings = (values: Iterable<string>): string[] =>
  [...values].sort((left, right) => left.localeCompare(right));

const sortCounts = (counts: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));

const inspectWaysNodes = (
  nodes: WaysNode[],
  summary: Omit<WaysFormatterSummary, 'valid' | 'error' | 'structure'>
) => {
  nodes.forEach((node) => {
    if (node.type === 'text') {
      return;
    }

    summary.count += 1;
    summary.variableNames.push(node.name);

    if (node.type === 'argument') {
      summary.expressionTypeCounts.argument += 1;
      return;
    }

    if (node.type === 'format') {
      summary.expressionTypeCounts.format += 1;
      summary.formatTypeCounts[node.formatType] =
        (summary.formatTypeCounts[node.formatType] || 0) + 1;
      return;
    }

    summary.expressionTypeCounts.branch += 1;
    summary.branchTypeCounts[node.formatType] += 1;
    Object.keys(node.options).forEach((key) => {
      summary.branchKeys.push(key);
      inspectWaysNodes(node.options[key], summary);
    });
  });
};

const buildWaysFormatterSummary = (text: string): WaysFormatterSummary => {
  const inspected = inspectWaysMessage(text);
  if (!inspected.valid) {
    return {
      valid: false,
      error: inspected.error,
      count: 0,
      variableNames: [],
      expressionTypeCounts: {
        argument: 0,
        format: 0,
        branch: 0,
      },
      formatTypeCounts: {},
      branchTypeCounts: {
        plural: 0,
        select: 0,
      },
      branchKeys: [],
      structure: null,
    };
  }

  const summary = {
    count: 0,
    variableNames: [] as string[],
    expressionTypeCounts: {
      argument: 0,
      format: 0,
      branch: 0,
    },
    formatTypeCounts: {} as Record<string, number>,
    branchTypeCounts: {
      plural: 0,
      select: 0,
    },
    branchKeys: [] as string[],
  };
  inspectWaysNodes(inspected.nodes, summary);

  return {
    valid: true,
    error: null,
    count: summary.count,
    variableNames: sortStrings(new Set(summary.variableNames)),
    expressionTypeCounts: summary.expressionTypeCounts,
    formatTypeCounts: sortCounts(summary.formatTypeCounts),
    branchTypeCounts: summary.branchTypeCounts,
    branchKeys: sortStrings(new Set(summary.branchKeys)),
    structure: inspected.structure,
  };
};

const buildRichTextTagSummary = (text: string): RichTextTagSummary => {
  const parsed = parseRichTextSourceMarkup(text);
  if (parsed.error || !parsed.value) {
    return {
      valid: false,
      error: parsed.error,
      count: 0,
      names: [],
      counts: {},
    };
  }

  const counts = sortCounts(collectRichTextSlotCounts(parsed.value.nodes));
  return {
    valid: true,
    error: null,
    count: Object.values(counts).reduce((total, count) => total + count, 0),
    names: Object.keys(counts),
    counts,
  };
};

export const inspectTranslationSource = (text: string): TranslationSourceStructure => {
  const waysFormatters = buildWaysFormatterSummary(text);
  const richTextTags = buildRichTextTagSummary(text);

  return {
    hasWaysFormatters: waysFormatters.valid && waysFormatters.count > 0,
    hasRichTextTags: richTextTags.valid && richTextTags.count > 0,
    waysFormatters,
    richTextTags,
  };
};

export const validateWaysFormatterStructure = (
  source: string,
  translation: string
): TranslationStructureValidationResult => {
  const sourceWays = inspectTranslationSource(source).waysFormatters;
  if (!sourceWays.valid) {
    return {
      valid: false,
      errors: [`Invalid source ways formatter syntax: ${sourceWays.error || 'Unknown error.'}`],
    };
  }

  const translatedWays = inspectTranslationSource(translation).waysFormatters;
  if (!translatedWays.valid) {
    return {
      valid: false,
      errors: [
        `Invalid translated ways formatter syntax: ${translatedWays.error || 'Unknown error.'}`,
      ],
    };
  }

  if (sourceWays.structure !== translatedWays.structure) {
    return {
      valid: false,
      errors: ['Ways formatter placeholders and branch structure must be preserved exactly.'],
    };
  }

  return {
    valid: true,
    errors: [],
  };
};

export const validateRichTextTagStructure = (
  source: string,
  translation: string
): TranslationStructureValidationResult => {
  const parsed = parseRichTextMarkupAgainstSource(translation, source);
  if (parsed.error) {
    return {
      valid: false,
      errors: [parsed.error],
    };
  }

  return {
    valid: true,
    errors: [],
  };
};

export const validateTranslationStructureDetailed = (
  source: string,
  translation: string
): DetailedTranslationStructureValidationResult => {
  const sourceStructure = inspectTranslationSource(source);
  const translatedStructure = inspectTranslationSource(translation);
  const waysFormatters = validateWaysFormatterStructure(source, translation);
  const richTextTags = validateRichTextTagStructure(source, translation);
  const errors = [...waysFormatters.errors, ...richTextTags.errors];

  return {
    valid: errors.length === 0,
    source: sourceStructure,
    translated: translatedStructure,
    waysFormatters,
    richTextTags,
    errors,
  };
};

export const validateTranslationStructure = (
  source: string,
  translation: string
): TranslationStructureValidationResult => {
  const result = validateTranslationStructureDetailed(source, translation);
  return {
    valid: result.valid,
    errors: result.errors,
  };
};
