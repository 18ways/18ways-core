import { describe, expect, it } from 'vitest';

import {
  inspectTranslationSource,
  validateRichTextTagStructure,
  validateTranslationStructure,
  validateTranslationStructureDetailed,
  validateWaysFormatterStructure,
} from '../translation-structure';

describe('validateWaysFormatterStructure', () => {
  it('accepts translations that preserve bare placeholders', () => {
    expect(
      validateWaysFormatterStructure(
        'Hello {name}, you have {count} new messages.',
        'Hola {name}, tienes {count} mensajes nuevos.'
      )
    ).toEqual({ valid: true, errors: [] });
  });

  it('accepts translations that preserve plural/select branch structure', () => {
    const source = '{count, plural, =0{No messages} one{{count} message} other{{count} messages}}';
    const translation =
      '{count, plural, =0{Keine Nachrichten} one{{count} Nachricht} other{{count} Nachrichten}}';

    expect(validateWaysFormatterStructure(source, translation)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects renamed placeholders', () => {
    expect(validateWaysFormatterStructure('Hello {name}', 'Hola {firstName}')).toEqual({
      valid: false,
      errors: ['Ways formatter placeholders and branch structure must be preserved exactly.'],
    });
  });

  it('rejects changes to formatter type or formatter options', () => {
    expect(
      validateWaysFormatterStructure(
        'Created at {createdAt, date, dateStyle:short}',
        'Creado el {createdAt}'
      )
    ).toEqual({
      valid: false,
      errors: ['Ways formatter placeholders and branch structure must be preserved exactly.'],
    });
  });

  it('rejects changed plural branch keys', () => {
    expect(
      validateWaysFormatterStructure(
        '{count, plural, =0{No messages} other{{count} messages}}',
        '{count, plural, one{{count} mensaje} other{{count} mensajes}}'
      )
    ).toEqual({
      valid: false,
      errors: ['Ways formatter placeholders and branch structure must be preserved exactly.'],
    });
  });

  it('rejects invalid translated formatter syntax', () => {
    expect(validateWaysFormatterStructure('Hello {name}', 'Hola {name')).toEqual({
      valid: false,
      errors: [
        'Invalid translated ways formatter syntax: Unclosed formatter expression in message.',
      ],
    });
  });
});

describe('validateRichTextTagStructure', () => {
  it('accepts translations that preserve XML-like rich-text tags', () => {
    expect(
      validateRichTextTagStructure(
        'Save <b>20%</b> on your next order.',
        'Ahorra <b>20%</b> en tu próximo pedido.'
      )
    ).toEqual({ valid: true, errors: [] });
  });

  it('rejects changed tag names', () => {
    expect(
      validateRichTextTagStructure(
        'Save <b>20%</b> on your next order.',
        'Ahorra <strong>20%</strong> en tu próximo pedido.'
      )
    ).toEqual({
      valid: false,
      errors: ['Unknown placeholder tag <strong>.'],
    });
  });

  it('rejects invalid markup', () => {
    expect(validateRichTextTagStructure('Save <b>20%</b>.', 'Ahorra <b>20%</strong>.')).toEqual({
      valid: false,
      errors: ['Unknown placeholder tag <strong>.'],
    });
  });
});

describe('validateTranslationStructure', () => {
  it('inspects source structure with parser-based detection', () => {
    expect(
      inspectTranslationSource('Save <b>{count, number}</b> on your next order.')
    ).toMatchObject({
      hasWaysFormatters: true,
      hasRichTextTags: true,
      waysFormatters: {
        valid: true,
        count: 1,
        variableNames: ['count'],
        expressionTypeCounts: {
          argument: 0,
          format: 1,
          branch: 0,
        },
        formatTypeCounts: {
          number: 1,
        },
        branchTypeCounts: {
          plural: 0,
          select: 0,
        },
      },
      richTextTags: {
        valid: true,
        count: 1,
        names: ['b'],
        counts: {
          b: 1,
        },
      },
    });
  });

  it('combines ways formatter and rich-text tag checks', () => {
    expect(
      validateTranslationStructure(
        'Save <b>{count, number}</b> on your next order.',
        'Ahorra <b>{count, number}</b> en tu próximo pedido.'
      )
    ).toEqual({ valid: true, errors: [] });
  });

  it('returns both errors when both structures are broken', () => {
    expect(
      validateTranslationStructure(
        'Save <b>{count, number}</b> on your next order.',
        'Ahorra <strong>{total}</strong> en tu próximo pedido.'
      )
    ).toEqual({
      valid: false,
      errors: [
        'Ways formatter placeholders and branch structure must be preserved exactly.',
        'Unknown placeholder tag <strong>.',
      ],
    });
  });

  it('returns detailed parser-based validation results', () => {
    expect(
      validateTranslationStructureDetailed(
        'Save <b>{count, number}</b> on your next order.',
        'Ahorra <b>{count, number}</b> en tu próximo pedido.'
      )
    ).toEqual({
      valid: true,
      source: {
        hasWaysFormatters: true,
        hasRichTextTags: true,
        waysFormatters: {
          valid: true,
          error: null,
          count: 1,
          variableNames: ['count'],
          expressionTypeCounts: {
            argument: 0,
            format: 1,
            branch: 0,
          },
          formatTypeCounts: {
            number: 1,
          },
          branchTypeCounts: {
            plural: 0,
            select: 0,
          },
          branchKeys: [],
          structure: '[{"type":"format","name":"count","formatType":"number","args":[]}]',
        },
        richTextTags: {
          valid: true,
          error: null,
          count: 1,
          names: ['b'],
          counts: {
            b: 1,
          },
        },
      },
      translated: {
        hasWaysFormatters: true,
        hasRichTextTags: true,
        waysFormatters: {
          valid: true,
          error: null,
          count: 1,
          variableNames: ['count'],
          expressionTypeCounts: {
            argument: 0,
            format: 1,
            branch: 0,
          },
          formatTypeCounts: {
            number: 1,
          },
          branchTypeCounts: {
            plural: 0,
            select: 0,
          },
          branchKeys: [],
          structure: '[{"type":"format","name":"count","formatType":"number","args":[]}]',
        },
        richTextTags: {
          valid: true,
          error: null,
          count: 1,
          names: ['b'],
          counts: {
            b: 1,
          },
        },
      },
      waysFormatters: {
        valid: true,
        errors: [],
      },
      richTextTags: {
        valid: true,
        errors: [],
      },
      errors: [],
    });
  });
});
