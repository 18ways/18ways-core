// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { readAcceptedLocalesFromWindow } from '../client-accepted-locales';

afterEach(() => {
  delete (window as Window & { __18WAYS_ACCEPTED_LOCALES__?: string[] })
    .__18WAYS_ACCEPTED_LOCALES__;
});

describe('readAcceptedLocalesFromWindow', () => {
  it('returns canonicalized unique accepted locales from the injected window state', () => {
    (window as Window & { __18WAYS_ACCEPTED_LOCALES__?: string[] }).__18WAYS_ACCEPTED_LOCALES__ = [
      'es-es',
      'en-GB',
      'es-ES',
      'invalid locale',
    ];

    expect(readAcceptedLocalesFromWindow()).toEqual(['es-ES', 'en-GB']);
  });

  it('returns an empty list when no accepted locales have been injected', () => {
    expect(readAcceptedLocalesFromWindow()).toEqual([]);
  });
});
