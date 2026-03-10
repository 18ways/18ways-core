import { describe, expect, it } from 'vitest';
import { extractLocalePrefix, findExactSupportedLocale, findSupportedLocale } from '../i18n-shared';

describe('locale matching', () => {
  it('keeps unsupported locale prefixes strip-able without treating them as supported', () => {
    expect(extractLocalePrefix('/en-US/docs', ['en-GB'])).toEqual({
      locale: null,
      unlocalizedPathname: '/docs',
      localizedPathname: '/en-US/docs',
    });
  });

  it('matches exact supported locales without falling through to same-language variants', () => {
    expect(findExactSupportedLocale('en-US', ['en-GB', 'en-US'])).toBe('en-US');
    expect(findExactSupportedLocale('en-US', ['en-GB'])).toBeNull();
  });

  it('falls back to the first same-language supported locale', () => {
    expect(findSupportedLocale('en-AU', ['en-GB', 'en-US'])).toBe('en-GB');
    expect(findSupportedLocale('en-AU', ['fr-FR', 'en-US'])).toBe('en-US');
  });
});
