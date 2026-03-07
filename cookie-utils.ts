export type BrowserCookieSameSite = 'lax' | 'strict' | 'none';

export type BrowserCookieWriteOptions = {
  maxAge?: number;
  sameSite?: BrowserCookieSameSite;
  secure?: boolean;
  path?: string;
};

const decodeCookieValue = (rawValue: string): string => {
  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
};

const resolveSameSiteValue = (sameSite?: BrowserCookieSameSite): string => {
  if (sameSite === 'strict') {
    return 'Strict';
  }
  if (sameSite === 'none') {
    return 'None';
  }
  return 'Lax';
};

const shouldUseSecureCookie = (secure?: boolean): boolean => {
  if (typeof secure === 'boolean') {
    return secure;
  }
  return typeof window !== 'undefined' && window.location.protocol === 'https:';
};

export const readCookieFromDocument = (cookieName: string): string | null => {
  if (typeof document === 'undefined') {
    return null;
  }

  const targetPrefix = `${cookieName}=`;
  const entry = document.cookie
    .split(';')
    .map((cookiePart) => cookiePart.trim())
    .find((cookiePart) => cookiePart.startsWith(targetPrefix));

  if (!entry) {
    return null;
  }

  return decodeCookieValue(entry.slice(targetPrefix.length));
};

export const writeCookieToDocument = (
  cookieName: string,
  value: string,
  options: BrowserCookieWriteOptions = {}
): void => {
  if (typeof document === 'undefined') {
    return;
  }

  const path = options.path || '/';
  const sameSite = resolveSameSiteValue(options.sameSite);
  const segments = [
    `${cookieName}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    `SameSite=${sameSite}`,
  ];

  if (typeof options.maxAge === 'number') {
    segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }

  if (shouldUseSecureCookie(options.secure)) {
    segments.push('Secure');
  }

  document.cookie = segments.join('; ');
};
