// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import {
  getWindowTranslationStoreHydrationPayload,
  mergeWindowTranslationStoreHydrationPayload,
} from '../common';

afterEach(() => {
  delete window.__18WAYS_TRANSLATION_STORE__;
});

describe('window translation store hydration payload', () => {
  it('deep-merges translations while explicit config remains a single source of truth', () => {
    mergeWindowTranslationStoreHydrationPayload({
      translations: {
        'es-ES': {
          home: {
            hash_1: 'Hola',
          },
        },
      },
      config: {
        acceptedLocales: ['en-GB', 'es-ES'],
        translationFallback: {
          default: 'source',
          overrides: [{ locale: 'es-ES', fallback: 'blank' }],
        },
      },
    });

    mergeWindowTranslationStoreHydrationPayload({
      translations: {
        'es-ES': {
          home: {
            hash_2: 'Adios',
          },
        },
        'fr-FR': {
          home: {
            hash_1: 'Bonjour',
          },
        },
      },
      config: {
        acceptedLocales: ['fr-FR'],
        translationFallback: {
          default: 'key',
          overrides: [{ locale: 'fr-FR', fallback: 'source' }],
        },
      },
    });

    expect(getWindowTranslationStoreHydrationPayload()).toEqual({
      translations: {
        'es-ES': {
          home: {
            hash_1: 'Hola',
            hash_2: 'Adios',
          },
        },
        'fr-FR': {
          home: {
            hash_1: 'Bonjour',
          },
        },
      },
      config: {
        acceptedLocales: ['fr-FR'],
        translationFallback: {
          default: 'key',
          overrides: [{ locale: 'fr-FR', fallback: 'source' }],
        },
      },
    });
    expect(window.__18WAYS_TRANSLATION_STORE__).toEqual(
      getWindowTranslationStoreHydrationPayload()
    );
  });
});
