import assert from 'node:assert/strict';
import { create18waysEngine } from '@18ways/core/engine';
import type { InProgressTranslation } from '@18ways/core/common';
import { encryptTranslationValue } from '@18ways/core/crypto';

const SOURCE_TEXTS = ['Hello world', 'Try changing language', 'Hello {name}'] as const;

const TRANSLATION_TABLE: Record<string, Record<string, string>> = {
  'en-US': {
    'Hello world': 'Hello world',
    'Try changing language': 'Try changing language',
    'Hello {name}': 'Hello {name}',
  },
  'ja-JP': {
    'Hello world': 'こんにちは世界',
    'Try changing language': '言語を切り替えてください',
    'Hello {name}': 'こんにちは {name}',
  },
  'es-ES': {
    'Hello world': 'Hola Mundo',
    'Try changing language': 'Prueba a cambiar el idioma',
    'Hello {name}': 'Hola {name}',
  },
};

type HelloWorldView = {
  hello: string;
  subtitle: string;
  greeting: string;
};

class VanillaHelloWorldApp {
  constructor(private readonly engine: ReturnType<typeof create18waysEngine>) {}

  render = async (): Promise<HelloWorldView> => {
    const hello = await this.engine.t('Hello world');
    const subtitle = await this.engine.t('Try changing language');
    const greeting = await this.engine.t('Hello {name}', {
      vars: { name: 'Ada' },
    });

    return {
      hello,
      subtitle,
      greeting,
    };
  };

  switchLanguage = async (locale: string): Promise<HelloWorldView> => {
    this.engine.setLocale(locale);
    return this.render();
  };
}

const run = async () => {
  const fetchCalls: Array<{ targetLocale: string; key: string }> = [];

  const mockFetcher: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    assert.equal(url.endsWith('/translate'), true);

    const headers = new Headers((init?.headers || {}) as HeadersInit);
    assert.equal(headers.get('x-api-key'), 'demo-key');

    const payload = JSON.parse(String(init?.body || '{}')) as { payload: InProgressTranslation[] };
    const items = Array.isArray(payload.payload) ? payload.payload : [];

    const data = items.map((item) => {
      fetchCalls.push({ targetLocale: item.targetLocale, key: item.key });
      const translatedText = TRANSLATION_TABLE[item.targetLocale]?.[item.text] || item.text;

      return {
        locale: item.targetLocale,
        key: item.key,
        textHash: item.textHash,
        translation: encryptTranslationValue({
          translatedText,
          sourceText: item.text,
          locale: item.targetLocale,
          key: item.key,
          textHash: item.textHash,
        }),
      };
    });

    return new Response(JSON.stringify({ data, errors: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const engine = create18waysEngine({
    apiKey: 'demo-key',
    apiUrl: 'https://api.18ways.local',
    baseLocale: 'en-US',
    locale: 'en-US',
    context: 'hello-world',
    fetcher: mockFetcher,
  });

  const app = new VanillaHelloWorldApp(engine);

  const english = await app.render();
  await engine.getStore().waitForIdle();
  assert.deepEqual(english, {
    hello: TRANSLATION_TABLE['en-US'][SOURCE_TEXTS[0]],
    subtitle: TRANSLATION_TABLE['en-US'][SOURCE_TEXTS[1]],
    greeting: 'Hello Ada',
  });
  assert.equal(fetchCalls.length > 0, true);

  const japanese = await app.switchLanguage('ja-JP');
  assert.deepEqual(japanese, {
    hello: TRANSLATION_TABLE['ja-JP'][SOURCE_TEXTS[0]],
    subtitle: TRANSLATION_TABLE['ja-JP'][SOURCE_TEXTS[1]],
    greeting: 'こんにちは Ada',
  });

  const callCountAfterJapanese = fetchCalls.length;
  assert.equal(callCountAfterJapanese > 0, true);

  const spanish = await app.switchLanguage('es-ES');
  assert.deepEqual(spanish, {
    hello: TRANSLATION_TABLE['es-ES'][SOURCE_TEXTS[0]],
    subtitle: TRANSLATION_TABLE['es-ES'][SOURCE_TEXTS[1]],
    greeting: 'Hola Ada',
  });
  const callCountAfterSpanish = fetchCalls.length;
  assert.equal(callCountAfterSpanish > callCountAfterJapanese, true);

  const japaneseAgain = await app.switchLanguage('ja-JP');
  assert.deepEqual(japaneseAgain, {
    hello: TRANSLATION_TABLE['ja-JP'][SOURCE_TEXTS[0]],
    subtitle: TRANSLATION_TABLE['ja-JP'][SOURCE_TEXTS[1]],
    greeting: 'こんにちは Ada',
  });
  assert.equal(fetchCalls.length, callCountAfterSpanish);

  console.log('[18ways-core:e2e] vanilla hello-world + language switching flow passed');
};

run().catch((error) => {
  console.error('[18ways-core:e2e] failed', error);
  process.exit(1);
});
