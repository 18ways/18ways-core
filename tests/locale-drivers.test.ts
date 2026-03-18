import { describe, expect, it, vi } from 'vitest';
import type { LocaleDriver } from '../locale-engine';
import {
  SessionCookieDriver,
  createLocaleDrivers,
  createLocaleEngine,
  rankSupportedLocalesByPreference,
  readPreferredLocalesFromAcceptLanguageHeader,
  type LocaleDriverContext,
} from '../locale-drivers';
import { WAYS_LOCALE_COOKIE_NAME } from '../i18n-shared';

describe('createLocaleDrivers', () => {
  it('places extra drivers between session and browser/base defaults', () => {
    const pathDriver: LocaleDriver<LocaleDriverContext> = {
      name: 'path',
      getLocale: () => null,
      setLocale: () => {},
      handleListeners: () => {},
    };

    expect(createLocaleDrivers([pathDriver]).map((driver) => driver.name)).toEqual([
      'session-cookie',
      'path',
      'browser-preference',
      'base-locale',
    ]);
  });
});

describe('createLocaleEngine', () => {
  it('normalizes accepted locales for extra drivers', async () => {
    const engine = createLocaleEngine<LocaleDriverContext>({
      baseLocale: 'en-GB',
      acceptedLocales: ['en-GB'],
      extraDrivers: [
        {
          name: 'path',
          getLocale: () => 'en-US',
          setLocale: () => {},
          handleListeners: () => {},
        },
      ],
    });

    const resolution = await engine.resolve({
      baseLocale: 'en-GB',
    });

    expect(resolution.locale).toBe('en-GB');
    expect(resolution.resolvedBy).toBe('path');
  });

  it('treats language-only ranges as direct matches before regional fallbacks', async () => {
    const engine = createLocaleEngine<LocaleDriverContext>({
      baseLocale: 'en-GB',
      acceptedLocales: ['fr-FR', 'en-GB'],
    });

    const resolution = await engine.resolve({
      baseLocale: 'en-GB',
      acceptedLocales: ['fr-FR', 'en-GB'],
      acceptLanguageHeader: 'es-MX;q=1, fr-CA;q=0.9, en;q=0.8',
    });

    expect(resolution.locale).toBe('en-GB');
    expect(resolution.resolvedBy).toBe('browser-preference');
  });

  it('prefers an exact accept-language match before any fallback match', async () => {
    const engine = createLocaleEngine<LocaleDriverContext>({
      baseLocale: 'en-GB',
      acceptedLocales: ['fr-FR', 'en-GB'],
    });

    const resolution = await engine.resolve({
      baseLocale: 'en-GB',
      acceptedLocales: ['fr-FR', 'en-GB'],
      acceptLanguageHeader: 'fr-FR;q=0.2, en-US;q=0.9',
    });

    expect(resolution.locale).toBe('fr-FR');
    expect(resolution.resolvedBy).toBe('browser-preference');
  });

  it('prefers a language-only direct match over a lower-q later exact locale', async () => {
    const engine = createLocaleEngine<LocaleDriverContext>({
      baseLocale: 'en-GB',
      acceptedLocales: ['fr-FR', 'en-GB'],
    });

    const resolution = await engine.resolve({
      baseLocale: 'en-GB',
      acceptedLocales: ['fr-FR', 'en-GB'],
      acceptLanguageHeader: 'fr-CA;q=1, en;q=0.9, fr-FR;q=0.8',
    });

    expect(resolution.locale).toBe('en-GB');
    expect(resolution.resolvedBy).toBe('browser-preference');
  });

  it('uses regional fallbacks when no exact or generic language match exists', async () => {
    const engine = createLocaleEngine<LocaleDriverContext>({
      baseLocale: 'en-GB',
      acceptedLocales: ['fr-FR', 'en-GB'],
    });

    const resolution = await engine.resolve({
      baseLocale: 'en-GB',
      acceptedLocales: ['fr-FR', 'en-GB'],
      acceptLanguageHeader: 'es-MX;q=1, fr-CA;q=0.9, de-DE;q=0.8',
    });

    expect(resolution.locale).toBe('fr-FR');
    expect(resolution.resolvedBy).toBe('browser-preference');
  });

  it('falls back to the base locale only after exact and fallback matching fail', async () => {
    const engine = createLocaleEngine<LocaleDriverContext>({
      baseLocale: 'en-GB',
      acceptedLocales: ['fr-FR'],
    });

    const resolution = await engine.resolve({
      baseLocale: 'en-GB',
      acceptedLocales: ['fr-FR'],
      acceptLanguageHeader: 'en-GB;q=1, ja-JP;q=0.9',
    });

    expect(resolution.locale).toBe('en-GB');
    expect(resolution.resolvedBy).toBe('base-locale');
  });
});

describe('readPreferredLocalesFromAcceptLanguageHeader', () => {
  it('orders recognized locales by q descending and keeps header order for ties', () => {
    expect(
      readPreferredLocalesFromAcceptLanguageHeader(
        'fr-FR;q=0.2, en-US;q=0.9, es-ES;q=0.9, en-US;q=0.7'
      )
    ).toEqual(['en-US', 'es-ES', 'fr-FR']);
  });

  it('skips q=0 and wildcard entries', () => {
    expect(readPreferredLocalesFromAcceptLanguageHeader('*, fr-FR;q=0, en;q=0.8')).toEqual(['en']);
  });
});

describe('rankSupportedLocalesByPreference', () => {
  it('returns exact matches first and then related supported locales for each candidate', () => {
    expect(
      rankSupportedLocalesByPreference(
        ['fr-FR', 'en-GB'],
        ['en-GB', 'en-US', 'fr-FR', 'fr-CA', 'de-DE']
      )
    ).toEqual(['fr-FR', 'fr-CA', 'en-GB', 'en-US']);
  });

  it('expands language-only candidates to every supported locale in that language', () => {
    expect(
      rankSupportedLocalesByPreference(
        ['en', 'fr-FR'],
        ['en-GB', 'en-US', 'fr-FR', 'fr-CA', 'de-DE']
      )
    ).toEqual(['en-GB', 'en-US', 'fr-FR', 'fr-CA']);
  });

  it('deduplicates overlapping candidates and skips unrecognized entries', () => {
    expect(
      rankSupportedLocalesByPreference(['fr-FR', 'fr', 'bogus', 'fr-CA'], ['fr-FR', 'fr-CA'])
    ).toEqual(['fr-FR', 'fr-CA']);
  });
});

describe('SessionCookieDriver', () => {
  it('continues locale sync when cookie writes are blocked', async () => {
    const setCurrentLocale = vi.fn();

    await expect(
      SessionCookieDriver.setLocale('es-ES', {
        baseLocale: 'en-GB',
        writeCookie: () => {
          throw new Error('Cookie write blocked');
        },
        setCurrentLocale,
      })
    ).resolves.toBeUndefined();

    expect(setCurrentLocale).toHaveBeenCalledWith('es-ES');
  });

  it('reads from the canonical locale cookie', () => {
    const locale = SessionCookieDriver.getLocale({
      baseLocale: 'en-GB',
      readCookie: (cookieName) => (cookieName === WAYS_LOCALE_COOKIE_NAME ? 'fr-FR' : null),
    });

    expect(locale).toBe('fr-FR');
  });

  it('writes locale cookies by default', async () => {
    const writeCookie = vi.fn();

    await SessionCookieDriver.setLocale('es-ES', {
      baseLocale: 'en-GB',
      writeCookie,
    });

    expect(writeCookie).toHaveBeenCalledTimes(1);
    expect(writeCookie).toHaveBeenCalledWith(WAYS_LOCALE_COOKIE_NAME, 'es-ES', expect.any(Object));
  });

  it('does not write locale cookies when persistence is disabled', async () => {
    const writeCookie = vi.fn();

    await SessionCookieDriver.setLocale('es-ES', {
      baseLocale: 'en-GB',
      persistLocaleCookie: false,
      writeCookie,
    });

    expect(writeCookie).not.toHaveBeenCalled();
  });

  it('writes the persistent locale cookie with cookie options', async () => {
    const writeCookie = vi.fn();

    await SessionCookieDriver.setLocale('es-ES', {
      baseLocale: 'en-GB',
      writeCookie,
    });

    expect(writeCookie).toHaveBeenCalledWith(WAYS_LOCALE_COOKIE_NAME, 'es-ES', {
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      path: '/',
    });
  });
});
