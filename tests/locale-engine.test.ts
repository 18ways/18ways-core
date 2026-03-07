import { describe, expect, it, vi } from 'vitest';
import { LocaleEngine, type LocaleDriver } from '../locale-engine';

type Context = {
  values: Record<string, string | null>;
  setCalls: Array<{ driver: string; locale: string }>;
  onLocaleSynced?: (locale: string) => void | Promise<void>;
};

const driver = (name: string): LocaleDriver<Context> => ({
  name,
  getLocale: (context) => context.values[name],
  setLocale: (locale, context) => {
    context.setCalls.push({ driver: name, locale });
    context.values[name] = locale;
  },
  handleListeners: () => {},
});

describe('LocaleEngine', () => {
  it('resolves locale from first non-null driver', async () => {
    const context: Context = {
      values: {
        session: null,
        path: 'fr-FR',
        browser: 'es-ES',
      },
      setCalls: [],
    };

    const engine = new LocaleEngine<Context>({
      baseLocale: 'en-GB',
      drivers: [driver('session'), driver('path'), driver('browser')],
    });

    const resolution = await engine.resolve(context);
    expect(resolution.locale).toBe('fr-FR');
    expect(resolution.resolvedBy).toBe('path');
  });

  it('syncs only changed drivers in changed-only mode', async () => {
    const context: Context = {
      values: {
        session: 'en-GB',
        path: 'fr-FR',
      },
      setCalls: [],
    };

    const engine = new LocaleEngine<Context>({
      baseLocale: 'en-GB',
      drivers: [driver('session'), driver('path')],
    });

    await engine.sync(context, 'en-GB', { mode: 'changed-only' });
    expect(context.setCalls).toEqual([{ driver: 'path', locale: 'en-GB' }]);
  });

  it('syncs all drivers in all mode', async () => {
    const context: Context = {
      values: {
        session: 'en-GB',
        path: 'en-GB',
      },
      setCalls: [],
    };

    const engine = new LocaleEngine<Context>({
      baseLocale: 'en-GB',
      drivers: [driver('session'), driver('path')],
    });

    await engine.sync(context, 'en-GB', { mode: 'all' });
    expect(context.setCalls).toEqual([
      { driver: 'session', locale: 'en-GB' },
      { driver: 'path', locale: 'en-GB' },
    ]);
  });

  it('runs driver setLocale calls in parallel', async () => {
    let resolveSession: (() => void) | null = null;
    let resolvePath: (() => void) | null = null;

    const sessionSet = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSession = resolve;
        })
    );
    const pathSet = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePath = resolve;
        })
    );

    const engine = new LocaleEngine({
      baseLocale: 'en-GB',
      drivers: [
        {
          name: 'session',
          getLocale: () => 'fr-FR',
          setLocale: sessionSet,
          handleListeners: () => {},
        },
        {
          name: 'path',
          getLocale: () => 'de-DE',
          setLocale: pathSet,
          handleListeners: () => {},
        },
      ],
    });

    const syncPromise = engine.sync({} as any, 'en-GB', { mode: 'all' });

    await Promise.resolve();
    expect(sessionSet).toHaveBeenCalledTimes(1);
    expect(pathSet).toHaveBeenCalledTimes(1);

    resolveSession?.();
    resolvePath?.();
    await syncPromise;
  });

  it('falls back to base locale when all drivers return null', async () => {
    const setLocale = vi.fn();
    const engine = new LocaleEngine({
      baseLocale: 'en-GB',
      drivers: [
        {
          name: 'session',
          getLocale: () => null,
          setLocale,
          handleListeners: () => {},
        },
      ],
    });

    const resolution = await engine.resolve({} as any);
    expect(resolution.locale).toBe('en-GB');
    expect(resolution.resolvedBy).toBeNull();
  });

  it('runs onLocaleSynced after driver setLocale operations finish', async () => {
    const callOrder: string[] = [];
    let resolveDriver: (() => void) | null = null;

    const engine = new LocaleEngine<Context>({
      baseLocale: 'en-GB',
      drivers: [
        {
          name: 'path',
          getLocale: () => null,
          setLocale: () =>
            new Promise<void>((resolve) => {
              resolveDriver = () => {
                callOrder.push('setLocale');
                resolve();
              };
            }),
          handleListeners: () => {},
        },
      ],
    });

    const context: Context = {
      values: {
        path: null,
      },
      setCalls: [],
      onLocaleSynced: (locale) => {
        callOrder.push(`onLocaleSynced:${locale}`);
      },
    };

    const syncPromise = engine.sync(context, 'fr-fr', { mode: 'all' });
    await Promise.resolve();
    expect(callOrder).toEqual([]);

    resolveDriver?.();
    await syncPromise;

    expect(callOrder).toEqual(['setLocale', 'onLocaleSynced:fr-FR']);
  });

  it('registers and cleans up driver listeners', async () => {
    const cleanup = vi.fn();
    const handleListeners = vi.fn(() => cleanup);
    const sync = vi.fn();

    const engine = new LocaleEngine({
      baseLocale: 'en-GB',
      drivers: [
        {
          name: 'path',
          getLocale: () => null,
          setLocale: () => {},
          handleListeners,
        },
      ],
    });

    const context = {} as Context;
    const dispose = await engine.handleListeners(context, sync);

    expect(handleListeners).toHaveBeenCalledWith(context, sync);
    dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
