import { canonicalizeLocale } from './i18n-shared';

type MaybePromise<T> = T | Promise<T>;

export type LocaleSyncFn = (locale: string) => MaybePromise<void>;
export type LocaleListenerCleanup = void | (() => void);

type LocaleSyncHookContext = {
  onLocaleSynced?: (locale: string) => MaybePromise<void>;
};

export type LocaleSyncMode = 'changed-only' | 'all';

export interface LocaleDriver<TContext> {
  name: string;
  getLocale: (context: TContext) => MaybePromise<string | null | undefined>;
  setLocale: (locale: string, context: TContext) => MaybePromise<void>;
  handleListeners: (context: TContext, sync: LocaleSyncFn) => MaybePromise<LocaleListenerCleanup>;
}

export interface LocaleEngineResolution {
  locale: string;
  resolvedBy: string | null;
  driverLocales: Map<string, string | null>;
}

export interface LocaleEngineOptions<TContext> {
  baseLocale: string;
  drivers: LocaleDriver<TContext>[];
  normalizeLocale?: (locale: string) => string;
}

const normalizeLocaleOrNull = (
  value: string | null | undefined,
  normalizeLocale: (locale: string) => string
): string | null => {
  if (!value) {
    return null;
  }

  const normalized = normalizeLocale(value);
  return normalized || null;
};

export class LocaleEngine<TContext> {
  private readonly baseLocale: string;
  private readonly drivers: LocaleDriver<TContext>[];
  private readonly normalizeLocale: (locale: string) => string;

  constructor(options: LocaleEngineOptions<TContext>) {
    this.normalizeLocale = options.normalizeLocale || canonicalizeLocale;
    this.baseLocale = normalizeLocaleOrNull(options.baseLocale, this.normalizeLocale) || 'en-GB';
    this.drivers = options.drivers;
  }

  async resolve(context: TContext): Promise<LocaleEngineResolution> {
    const driverLocales = new Map<string, string | null>();
    let resolvedBy: string | null = null;
    let locale: string | null = null;

    for (const driver of this.drivers) {
      const rawLocale = await driver.getLocale(context);
      const normalizedLocale = normalizeLocaleOrNull(rawLocale, this.normalizeLocale);
      driverLocales.set(driver.name, normalizedLocale);

      if (!locale && normalizedLocale) {
        locale = normalizedLocale;
        resolvedBy = driver.name;
      }
    }

    return {
      locale: locale || this.baseLocale,
      resolvedBy,
      driverLocales,
    };
  }

  async sync(
    context: TContext,
    locale: string,
    options?: {
      mode?: LocaleSyncMode;
      driverLocales?: Map<string, string | null>;
    }
  ): Promise<void> {
    const normalizedTargetLocale = normalizeLocaleOrNull(locale, this.normalizeLocale);
    if (!normalizedTargetLocale) {
      return;
    }

    const mode = options?.mode || 'changed-only';
    const driverLocales = new Map<string, string | null>(options?.driverLocales || []);

    if (mode === 'changed-only') {
      const missingDrivers = this.drivers.filter((driver) => !driverLocales.has(driver.name));

      if (missingDrivers.length) {
        const missingLocales = await Promise.all(
          missingDrivers.map(async (driver) => {
            const detected = await driver.getLocale(context);
            return [driver.name, normalizeLocaleOrNull(detected, this.normalizeLocale)] as const;
          })
        );

        missingLocales.forEach(([name, detectedLocale]) => {
          driverLocales.set(name, detectedLocale);
        });
      }
    }

    const setTasks: Promise<void>[] = [];
    for (const driver of this.drivers) {
      const currentLocale = driverLocales.get(driver.name) ?? null;
      if (mode === 'all' || currentLocale !== normalizedTargetLocale) {
        setTasks.push(Promise.resolve(driver.setLocale(normalizedTargetLocale, context)));
      }
    }

    await Promise.all(setTasks);

    const onLocaleSynced = (context as LocaleSyncHookContext).onLocaleSynced;
    if (typeof onLocaleSynced === 'function') {
      await onLocaleSynced(normalizedTargetLocale);
    }
  }

  async handleListeners(context: TContext, sync: LocaleSyncFn): Promise<() => void> {
    const cleanups = await Promise.all(
      this.drivers.map((driver) => Promise.resolve(driver.handleListeners(context, sync)))
    );

    return () => {
      cleanups.forEach((cleanup) => {
        if (typeof cleanup === 'function') {
          cleanup();
        }
      });
    };
  }

  async resolveAndSync(
    context: TContext,
    options?: {
      mode?: LocaleSyncMode;
    }
  ): Promise<LocaleEngineResolution> {
    const resolution = await this.resolve(context);
    await this.sync(context, resolution.locale, {
      mode: options?.mode,
      driverLocales: resolution.driverLocales,
    });
    return resolution;
  }
}
