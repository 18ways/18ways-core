import {
  buildTranslationFallbackValue,
  DEFAULT_TRANSLATION_FALLBACK_CONFIG,
  fetchConfig,
  fetchKnown,
  fetchKnownContext,
  fetchTranslations,
  generateHashId,
  init,
  resolveTranslationFallbackMode,
  type Fetcher,
  type InProgressTranslation,
  type _RequestInitDecorator,
  type TranslationFallbackConfig,
  type TranslationContextInput,
  type TranslationContextInputObject,
  type Translations,
} from './common';
import { decryptTranslationValue } from './crypto';
import { canonicalizeLocale } from './i18n-shared';
import { formatWaysParser, isRuntimeOnlyWaysMessage } from './parsers/ways-parser';
import { TranslationStore } from './translation-store';

const DEFAULT_BASE_LOCALE = 'en-GB';
const DEFAULT_CONTEXT_KEY = 'app';

const normalizeContextKey = (context?: TranslationContextInput): string => {
  if (!context) {
    return DEFAULT_CONTEXT_KEY;
  }

  if (typeof context === 'string') {
    const trimmed = context.trim();
    return trimmed || DEFAULT_CONTEXT_KEY;
  }

  const name = (context as TranslationContextInputObject).name;
  if (typeof name !== 'string') {
    return DEFAULT_CONTEXT_KEY;
  }

  const trimmed = name.trim();
  return trimmed || DEFAULT_CONTEXT_KEY;
};

const formatWithVars = (
  text: string,
  vars: Record<string, any> | undefined,
  locale: string
): string => {
  if (!vars || !Object.keys(vars).length) {
    return text;
  }
  return formatWaysParser(vars, text, locale);
};

export type WaysEngineOptions = {
  apiKey: string;
  baseLocale?: string;
  locale?: string;
  context?: TranslationContextInput;
  initialTranslations?: Translations;
  apiUrl?: string;
  fetcher?: Fetcher;
  cacheTtlSeconds?: number;
  origin?: string;
  /** @internal Adapter-only fetch init hook. */
  _requestInitDecorator?: _RequestInitDecorator;
};

export type WaysEngineTranslateOptions = {
  locale?: string;
  baseLocale?: string;
  context?: TranslationContextInput;
  vars?: Record<string, any>;
};

export class WaysEngine {
  private store: TranslationStore;
  private baseLocale: string;
  private targetLocale: string;
  private contextKey: string;
  private requestOrigin?: string;
  private translationFallbackConfigPromise: Promise<TranslationFallbackConfig> | null = null;

  constructor(options: WaysEngineOptions) {
    this.baseLocale = canonicalizeLocale(options.baseLocale || DEFAULT_BASE_LOCALE);
    this.targetLocale = canonicalizeLocale(options.locale || this.baseLocale);
    this.contextKey = normalizeContextKey(options.context);
    this.requestOrigin = options.origin;
    this.store = new TranslationStore({
      translations: (options.initialTranslations || {}) as Translations,
      fetchKnown: (entries) => fetchKnown(entries, { origin: this.requestOrigin }),
      fetchKnownContext:
        typeof window !== 'undefined'
          ? ({ targetLocale, key }) =>
              fetchKnownContext(targetLocale, key, { origin: this.requestOrigin })
          : undefined,
      fetchTranslations: (entries) => fetchTranslations(entries, { origin: this.requestOrigin }),
    });

    init({
      key: options.apiKey,
      baseLocale: options.baseLocale || this.baseLocale,
      apiUrl: options.apiUrl,
      fetcher: options.fetcher,
      cacheTtlSeconds: options.cacheTtlSeconds,
      _requestInitDecorator: options._requestInitDecorator,
    });
  }

  setLocale = (locale: string): void => {
    this.targetLocale = canonicalizeLocale(locale);
  };

  getLocale = (): string => this.targetLocale;

  getStore = (): TranslationStore => this.store;

  private getTranslationFallbackConfig = async (): Promise<TranslationFallbackConfig> => {
    if (!this.translationFallbackConfigPromise) {
      this.translationFallbackConfigPromise = fetchConfig({ origin: this.requestOrigin })
        .then((config) => config.translationFallback)
        .catch(() => DEFAULT_TRANSLATION_FALLBACK_CONFIG);
    }

    return this.translationFallbackConfigPromise;
  };

  t = async (text: string, options: WaysEngineTranslateOptions = {}): Promise<string> => {
    const sourceText = text.toString();
    const baseLocale = canonicalizeLocale(options.baseLocale || this.baseLocale);
    const targetLocale = canonicalizeLocale(options.locale || this.targetLocale);
    const contextKey = normalizeContextKey(options.context || this.contextKey);
    const textHash = generateHashId([sourceText, contextKey]);
    const entry: InProgressTranslation = {
      key: contextKey,
      textHash,
      baseLocale,
      targetLocale,
      text: sourceText,
    };

    if (isRuntimeOnlyWaysMessage(sourceText)) {
      return formatWithVars(sourceText, options.vars, targetLocale);
    }

    if (baseLocale === targetLocale) {
      this.store.enqueue(entry);
      return formatWithVars(sourceText, options.vars, targetLocale);
    }

    const tryReadCached = (): string | null => {
      const cached = this.store.getTranslation(targetLocale, contextKey, textHash);
      if (!cached) {
        return null;
      }

      try {
        const decrypted = decryptTranslationValue({
          encryptedText: cached,
          sourceText,
          locale: targetLocale,
          key: contextKey,
          textHash,
        });
        return typeof decrypted === 'string' ? decrypted : sourceText;
      } catch (error) {
        console.error('[18ways] Failed to decrypt cached core engine translation payload:', error);
        return null;
      }
    };

    const cachedText = tryReadCached();
    if (cachedText) {
      return formatWithVars(cachedText, options.vars, targetLocale);
    }

    await this.store.ensure([entry]);

    const translated = tryReadCached();
    if (translated) {
      return formatWithVars(translated, options.vars, targetLocale);
    }

    const translationFallbackConfig = await this.getTranslationFallbackConfig();
    const translatedFallback = buildTranslationFallbackValue(
      resolveTranslationFallbackMode(translationFallbackConfig, targetLocale),
      sourceText,
      contextKey
    );

    return formatWithVars(translatedFallback, options.vars, targetLocale);
  };
}

export const create18waysEngine = (options: WaysEngineOptions): WaysEngine =>
  new WaysEngine(options);
