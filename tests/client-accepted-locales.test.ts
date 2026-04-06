// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { readAcceptedLocalesFromWindow } from '../client-accepted-locales';

afterEach(() => {
  delete window.__18WAYS_TRANSLATION_STORE__;
});

describe('readAcceptedLocalesFromWindow', () => {
  it('returns canonicalized unique accepted locales from the injected window state', () => {
    window.__18WAYS_TRANSLATION_STORE__ = {
      translations: {},
      config: {
        acceptedLocales: ['es-es', 'en-GB', 'es-ES', 'invalid locale'],
        translationFallback: {
          default: 'source',
          overrides: [],
        },
      },
    };

    expect(readAcceptedLocalesFromWindow()).toEqual(['es-ES', 'en-GB']);
  });

  it('returns an empty list when no accepted locales have been injected', () => {
    expect(readAcceptedLocalesFromWindow()).toEqual([]);
  });

  it('prefers accepted locales from the merged window translation store payload', () => {
    window.__18WAYS_TRANSLATION_STORE__ = {
      translations: {},
      config: {
        acceptedLocales: ['fr-fr', 'en-GB', 'fr-FR'],
        translationFallback: {
          default: 'source',
          overrides: [],
        },
      },
    };

    expect(readAcceptedLocalesFromWindow()).toEqual(['fr-FR', 'en-GB']);
  });
});
