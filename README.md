![18ways logo](https://18ways.com/18w-light.svg)

# @18ways/core

18ways makes i18n easy. SEO-ready, AI-powered translations for modern products.

`@18ways/core` is the framework-agnostic runtime and engine layer that powers 18ways outside React-specific integrations.

## Install

```bash
npm install @18ways/core
```

## Basic translation

```ts
import { create18waysEngine } from '@18ways/core/engine';

const ways = create18waysEngine({
  apiKey: 'pk_live_GET_ME_FROM_YOUR_DASHBOARD_...',
  locale: 'fr-FR',
  baseLocale: 'en-GB',
  context: 'app',
});

const hello = await ways.t('Hello world');
ways.setLocale('de-DE');
const cta = await ways.t('Pay now', { context: 'checkout.button' });
```

Docs: [18ways.com/docs](https://18ways.com/docs)
