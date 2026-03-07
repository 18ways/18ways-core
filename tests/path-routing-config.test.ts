import { describe, expect, it } from 'vitest';
import { isPathRoutingEnabled, pathMatchesPattern } from '../i18n-shared';

describe('path routing config', () => {
  it('matches string prefix patterns', () => {
    expect(pathMatchesPattern('/dashboard/organizations', '/dashboard')).toBe(true);
    expect(pathMatchesPattern('/docs/getting-started', '/dashboard')).toBe(false);
  });

  it('matches wildcard string patterns', () => {
    expect(pathMatchesPattern('/docs/getting-started', '/docs/*')).toBe(true);
    expect(pathMatchesPattern('/pricing', '/docs/*')).toBe(false);
  });

  it('matches regular expression patterns', () => {
    expect(pathMatchesPattern('/api/translations', /^\/api(\/|$)/)).toBe(true);
    expect(pathMatchesPattern('/dashboard', /^\/api(\/|$)/)).toBe(false);
  });

  it('enables routing for all paths when no patterns are provided', () => {
    expect(isPathRoutingEnabled('/docs')).toBe(true);
    expect(isPathRoutingEnabled('/dashboard')).toBe(true);
  });

  it('respects include and exclude patterns together', () => {
    expect(
      isPathRoutingEnabled('/docs/getting-started', {
        include: ['/docs/*'],
        exclude: ['/docs/private*'],
      })
    ).toBe(true);

    expect(
      isPathRoutingEnabled('/docs/private/plan', {
        include: ['/docs/*'],
        exclude: ['/docs/private*'],
      })
    ).toBe(false);

    expect(
      isPathRoutingEnabled('/pricing', {
        include: ['/docs/*'],
        exclude: ['/docs/private*'],
      })
    ).toBe(false);
  });
});
