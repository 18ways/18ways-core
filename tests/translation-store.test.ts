import { describe, expect, it, vi } from 'vitest';
import { TranslationStore } from '../translation-store';

describe('TranslationStore', () => {
  it('deletes all locale entries for an unmounted context key', () => {
    const store = new TranslationStore({
      translations: {
        'en-GB': {
          'keep-key': {
            '["Hello","keep-key"]': ['Hello'],
          },
          'gc-key': {
            '["Bye","gc-key"]': ['Bye'],
          },
        },
        'fr-FR': {
          'gc-key': {
            '["Bye","gc-key"]': ['Au revoir'],
          },
        },
      },
      fetchTranslations: vi.fn(async () => ({ data: [], errors: [] })),
    });

    store.deleteContextTranslations('gc-key');

    expect(store.getTranslation('en-GB', 'gc-key', '["Bye","gc-key"]')).toBeUndefined();
    expect(store.getTranslation('fr-FR', 'gc-key', '["Bye","gc-key"]')).toBeUndefined();
    expect(store.getTranslation('en-GB', 'keep-key', '["Hello","keep-key"]')).toEqual(['Hello']);
  });
});
