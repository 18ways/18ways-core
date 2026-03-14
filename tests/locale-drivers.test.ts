import { describe, expect, it, vi } from 'vitest';
import type { LocaleDriver } from '../locale-engine';
import {
  SessionCookieDriver,
  createLocaleDrivers,
  createLocaleEngine,
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
