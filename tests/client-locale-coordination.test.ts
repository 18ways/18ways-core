import { describe, expect, it } from 'vitest';
import {
  consumeHandledClientLocaleSync,
  consumeSuppressedClientHistorySync,
  markClientLocaleSyncHandled,
  suppressNextClientHistorySync,
} from '../client-locale-coordination';

describe('client locale coordination', () => {
  it('canonicalizes locale markers before consuming them', () => {
    markClientLocaleSyncHandled('es-es');

    expect(consumeHandledClientLocaleSync('es-ES')).toBe(true);
    expect(consumeHandledClientLocaleSync('es-ES')).toBe(false);
  });

  it('normalizes pathname markers before consuming them', () => {
    suppressNextClientHistorySync('docs');

    expect(consumeSuppressedClientHistorySync('/docs')).toBe(true);
    expect(consumeSuppressedClientHistorySync('/docs')).toBe(false);
  });

  it('tracks multiple pending suppressions for the same key', () => {
    suppressNextClientHistorySync('/fr-FR/docs');
    suppressNextClientHistorySync('/fr-FR/docs');

    expect(consumeSuppressedClientHistorySync('/fr-FR/docs')).toBe(true);
    expect(consumeSuppressedClientHistorySync('/fr-FR/docs')).toBe(true);
    expect(consumeSuppressedClientHistorySync('/fr-FR/docs')).toBe(false);
  });
});
