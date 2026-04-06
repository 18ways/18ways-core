import type { ResolvedTranslationStoreHydrationPayload } from './common';

declare global {
  interface Window {
    __18WAYS_TRANSLATION_STORE__?: ResolvedTranslationStoreHydrationPayload;
  }
}

export {};
