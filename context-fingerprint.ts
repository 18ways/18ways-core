export const normalizeTranslationContextFingerprint = (value?: string | null): string => {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '';
};
