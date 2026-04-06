import {
  fetchConfig,
  fetchKnown,
  fetchKnownContext,
  fetchSeed,
  fetchTranslations,
  generateHashId,
  init,
  type Fetcher,
  type _RequestInitDecorator,
  type TranslationContextInput,
  type TranslationContextInputObject,
  type Translations,
} from './common';
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

  constructor(options: WaysEngineOptions) {
    this.baseLocale = canonicalizeLocale(options.baseLocale || DEFAULT_BASE_LOCALE);
    this.targetLocale = canonicalizeLocale(options.locale || this.baseLocale);
    this.contextKey = normalizeContextKey(options.context);
    this.requestOrigin = options.origin;
    const requestOptions = { origin: this.requestOrigin };
    this.store = new TranslationStore({
      baseLocale: this.baseLocale,
      locale: this.targetLocale,
      translations: (options.initialTranslations || {}) as Translations,
      fetchConfig: () => fetchConfig(requestOptions),
      fetchKnown: (entries) => fetchKnown(entries, requestOptions),
      fetchKnownContext:
        typeof window !== 'undefined'
          ? ({ targetLocale, key }) => fetchKnownContext(targetLocale, key, requestOptions)
          : undefined,
      fetchSeed: (keys, targetLocale) => fetchSeed(keys, targetLocale, requestOptions),
      fetchTranslations: (entries) => fetchTranslations(entries, requestOptions),
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
    this.store.setLocale(this.targetLocale);
  };

  getLocale = (): string => this.targetLocale;

  getStore = (): TranslationStore => this.store;

  t = async (text: string, options: WaysEngineTranslateOptions = {}): Promise<string> => {
    const sourceText = text.toString();
    const baseLocale = canonicalizeLocale(options.baseLocale || this.baseLocale);
    const targetLocale = canonicalizeLocale(options.locale || this.targetLocale);
    const contextKey = normalizeContextKey(options.context || this.contextKey);
    const textHash = generateHashId([sourceText, contextKey]);

    if (isRuntimeOnlyWaysMessage(sourceText)) {
      return formatWithVars(sourceText, options.vars, targetLocale);
    }

    const translated = await this.store.getTranslation({
      contextKey,
      textHash,
      text: sourceText,
      baseLocale,
      targetLocale,
    });

    return formatWithVars(translated, options.vars, targetLocale);
  };
}

export const create18waysEngine = (options: WaysEngineOptions): WaysEngine =>
  new WaysEngine(options);
