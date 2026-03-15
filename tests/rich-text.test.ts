import { describe, expect, it } from 'vitest';
import {
  parseRichTextMarkupAgainstSource,
  parseRichTextSourceMarkup,
  richTextMarkupToPlainText,
  serializeRichTextToMarkup,
  type RichTextValue,
} from '../rich-text';

describe('rich-text utilities', () => {
  it('serializes rich values to escaped markup strings', () => {
    const value: RichTextValue = {
      kind: 'rich',
      nodes: [
        { type: 'text', value: 'If you want to use < and > then ' },
        {
          type: 'slot',
          name: 'link',
          children: [{ type: 'text', value: 'click here' }],
        },
      ],
    };

    expect(serializeRichTextToMarkup(value.nodes)).toBe(
      'If you want to use &lt; and &gt; then <link>click here</link>'
    );
    expect(richTextMarkupToPlainText(serializeRichTextToMarkup(value.nodes))).toBe(
      'If you want to use < and > then click here'
    );
  });

  it('parses translated markup against source placeholders', () => {
    const parsed = parseRichTextMarkupAgainstSource(
      'Si quieres &lt;esto&gt;, <link>haz clic aquí</link>',
      'If you want &lt;this&gt;, <link>click here</link>'
    );

    expect(parsed.error).toBeNull();
    expect(parsed.value).toEqual({
      kind: 'rich',
      nodes: [
        { type: 'text', value: 'Si quieres <esto>, ' },
        {
          type: 'slot',
          name: 'link',
          children: [{ type: 'text', value: 'haz clic aquí' }],
        },
      ],
    });
  });

  it('rejects raw angle brackets in rich text translations', () => {
    const parsed = parseRichTextMarkupAgainstSource(
      'Si quieres <esto>, <link>haz clic aquí</link>',
      'If you want &lt;this&gt;, <link>click here</link>'
    );

    expect(parsed.value).toBeNull();
    expect(parsed.error).toContain('Unknown placeholder tag');
  });

  it('parses canonical source markup strings', () => {
    const parsed = parseRichTextSourceMarkup('<bold><link>hello</link></bold>');

    expect(parsed.error).toBeNull();
    expect(parsed.value).toEqual({
      kind: 'rich',
      nodes: [
        {
          type: 'slot',
          name: 'bold',
          children: [
            {
              type: 'slot',
              name: 'link',
              children: [{ type: 'text', value: 'hello' }],
            },
          ],
        },
      ],
    });
  });

  it('serializes and parses self-closing placeholder tags', () => {
    const value: RichTextValue = {
      kind: 'rich',
      nodes: [
        { type: 'text', value: 'Before' },
        {
          type: 'slot',
          name: 'br',
          children: [],
        },
        { type: 'text', value: 'After' },
      ],
    };

    expect(serializeRichTextToMarkup(value.nodes)).toBe('Before<br />After');
    expect(parseRichTextSourceMarkup('Before<br />After')).toEqual({
      error: null,
      value,
    });
  });
});
