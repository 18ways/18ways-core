import {
  fetchTranslations,
  generateHashId,
  init,
  type Fetcher,
  type InProgressTranslation,
  type _RequestInitDecorator,
  type TranslationContextInput,
  type TranslationContextInputObject,
  type Translations,
} from './common';
import { decryptTranslationValues } from './crypto';
import { canonicalizeLocale } from './i18n-shared';
import { formatWaysParser } from './parsers/ways-parser';
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

  constructor(options: WaysEngineOptions) {
    this.baseLocale = canonicalizeLocale(options.baseLocale || DEFAULT_BASE_LOCALE);
    this.targetLocale = canonicalizeLocale(options.locale || this.baseLocale);
    this.contextKey = normalizeContextKey(options.context);
    this.store = new TranslationStore({
      translations: (options.initialTranslations || {}) as Translations,
      fetchTranslations,
    });

    init({
      key: options.apiKey,
      apiUrl: options.apiUrl,
      fetcher: options.fetcher,
      cacheTtlSeconds: options.cacheTtlSeconds,
      origin: options.origin,
      _requestInitDecorator: options._requestInitDecorator,
    });
  }

  setLocale = (locale: string): void => {
    this.targetLocale = canonicalizeLocale(locale);
  };

  getLocale = (): string => this.targetLocale;

  getStore = (): TranslationStore => this.store;

  t = async (text: string, options: WaysEngineTranslateOptions = {}): Promise<string> => {
    const sourceText = text.toString();
    const baseLocale = canonicalizeLocale(options.baseLocale || this.baseLocale);
    const targetLocale = canonicalizeLocale(options.locale || this.targetLocale);
    const contextKey = normalizeContextKey(options.context || this.contextKey);
    const texts = [sourceText];
    const textsHash = generateHashId([...texts, contextKey]);

    if (baseLocale === targetLocale) {
      return formatWithVars(sourceText, options.vars, targetLocale);
    }

    const tryReadCached = (): string | null => {
      const cached = this.store.getTranslation(targetLocale, contextKey, textsHash);
      if (!cached) {
        return null;
      }

      try {
        const [decrypted] = decryptTranslationValues({
          encryptedTexts: cached,
          sourceTexts: texts,
          locale: targetLocale,
          key: contextKey,
          textsHash,
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

    const entry: InProgressTranslation = {
      key: contextKey,
      textsHash,
      baseLocale,
      targetLocale,
      texts,
    };

    await this.store.ensure([entry]);

    const translated = tryReadCached() || sourceText;
    return formatWithVars(translated, options.vars, targetLocale);
  };
}

export const create18waysEngine = (options: WaysEngineOptions): WaysEngine =>
  new WaysEngine(options);
