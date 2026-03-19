import './styles.css';
import { create18waysEngine } from '@18ways/core/engine';

const app = document.querySelector('#app');

if (!app) {
  throw new Error('Missing #app root');
}

const locales = [
  { label: 'English', value: 'en-GB' },
  { label: 'Caesar Shift', value: 'en-GB-x-caesar' },
];

const ways = create18waysEngine({
  apiKey: 'pk_dummy_demo_token',
  locale: 'en-GB-x-caesar',
  baseLocale: 'en-GB',
  context: 'docs.core.example',
});

const render = async () => {
  const headline = await ways.t('Hello world');
  const body = await ways.t('Translate plain strings in any runtime.');
  const cta = await ways.t('Pay now', {
    context: 'checkout.button',
  });

  app.innerHTML = `
    <main class="core-demo-shell">
      <section class="core-demo-card">
        <p class="core-demo-eyebrow">
          @18ways/core
        </p>
        <h1 class="core-demo-title">${headline}</h1>
        <p class="core-demo-copy">${body}</p>
        <div class="core-demo-actions">
          <span class="core-demo-label">Locale</span>
          <div class="core-demo-locale-buttons" role="group" aria-label="Choose a locale">
            ${locales
              .map(
                (option) =>
                  `<button type="button" class="core-demo-locale-button ${ways.getLocale() === option.value ? 'is-active' : ''}" data-locale="${option.value}">${option.label}</button>`
              )
              .join('')}
          </div>
          <button type="button" class="core-demo-button">
            ${cta}
          </button>
        </div>
      </section>
    </main>
  `;

  const localeButtons = document.querySelectorAll('[data-locale]');
  localeButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      const nextLocale = event.currentTarget.getAttribute('data-locale');
      if (!nextLocale) {
        return;
      }
      ways.setLocale(nextLocale);
      void render();
    });
  });
};

void render();
