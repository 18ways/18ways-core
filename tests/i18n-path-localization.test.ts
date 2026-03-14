import { describe, expect, it } from 'vitest';
import { localizePathname } from '../i18n-shared';

const PATH_ROUTING = {
  exclude: ['/dashboard'],
};

describe('i18n pathname localization', () => {
  it('replaces the current locale prefix when switching locales', () => {
    expect(
      localizePathname('/en-GB/docs/getting-started', 'ja-JP', {
        acceptedLocales: ['en-GB', 'ja-JP'],
        currentLocale: 'en-GB',
        pathRouting: PATH_ROUTING,
      })
    ).toBe('/ja-JP/docs/getting-started');
  });

  it('does not duplicate the target locale prefix when locale state is stale', () => {
    expect(
      localizePathname('/ja-JP', 'ja-JP', {
        acceptedLocales: ['en-GB'],
        currentLocale: 'en-GB',
        pathRouting: PATH_ROUTING,
      })
    ).toBe('/ja-JP');
  });

  it('preserves non-locale path segments', () => {
    expect(
      localizePathname('/japan/travel', 'ja-JP', {
        acceptedLocales: ['en-GB'],
        currentLocale: 'en-GB',
        pathRouting: PATH_ROUTING,
      })
    ).toBe('/ja-JP/japan/travel');
  });

  it('keeps excluded routes unlocalized when path routing is disabled', () => {
    expect(
      localizePathname('/dashboard/organizations', 'ja-JP', {
        acceptedLocales: ['en-GB', 'ja-JP'],
        currentLocale: 'en-GB',
        pathRouting: PATH_ROUTING,
      })
    ).toBe('/dashboard/organizations');
  });

  it('leaves paths unchanged when path routing is omitted', () => {
    expect(
      localizePathname('/docs/getting-started', 'ja-JP', {
        acceptedLocales: ['en-GB', 'ja-JP'],
        currentLocale: 'en-GB',
      })
    ).toBe('/docs/getting-started');
  });
});
