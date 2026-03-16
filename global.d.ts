import type { Translations, TranslationFallbackConfig } from './common';

declare global {
  interface Window {
    __18WAYS_IN_MEMORY_TRANSLATIONS__?: Translations;
    __18WAYS_ACCEPTED_LOCALES__?: string[];
    __18WAYS_TRANSLATION_FALLBACK_CONFIG__?: TranslationFallbackConfig;
  }
}

export {};
