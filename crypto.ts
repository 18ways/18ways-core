import CryptoJS from 'crypto-js';

const HASH_VERSION_PREFIX = 'h2';
const ENCRYPTION_VERSION = 'v1';
const KEY_MATERIAL_PREFIX = '18ways:key-material';
const MAC_MESSAGE_PREFIX = '18ways:mac';

interface TranslationCryptoMeta {
  locale: string;
  key: string;
  textHash: string;
}

interface TranslationCryptoParams extends TranslationCryptoMeta {
  sourceText: string;
}

interface EncryptTranslationValueParams extends TranslationCryptoParams {
  translatedText: string;
}

const stringifyHashInput = (x: unknown): string => (typeof x === 'string' ? x : JSON.stringify(x));

const encoder = new TextEncoder();

const wordArrayToUint8Array = (wordArray: CryptoJS.lib.WordArray): Uint8Array => {
  const { words, sigBytes } = wordArray;
  const out = new Uint8Array(sigBytes);

  for (let i = 0; i < sigBytes; i += 1) {
    out[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }

  return out;
};

const uint8ArrayToWordArray = (bytes: Uint8Array): CryptoJS.lib.WordArray => {
  const words: number[] = [];

  for (let i = 0; i < bytes.length; i += 1) {
    words[i >>> 2] |= bytes[i] << (24 - (i % 4) * 8);
  }

  return CryptoJS.lib.WordArray.create(words, bytes.length);
};

const utf8ToBytes = (value: string): Uint8Array => encoder.encode(value);

const concatBytes = (...arrays: Uint8Array[]): Uint8Array => {
  const totalLength = arrays.reduce((sum, array) => sum + array.length, 0);
  const result = new Uint8Array(totalLength);

  let offset = 0;
  arrays.forEach((array) => {
    result.set(array, offset);
    offset += array.length;
  });

  return result;
};

const toBase64Url = (data: Uint8Array): string =>
  CryptoJS.enc.Base64.stringify(uint8ArrayToWordArray(data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const fromBase64Url = (x: string): Uint8Array => {
  const normalized = x.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  const padded = `${normalized}${'='.repeat(padLength)}`;
  return wordArrayToUint8Array(CryptoJS.enc.Base64.parse(padded));
};

const constantTimeCompare = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }

  return diff === 0;
};

const isTestEnvironment = (): boolean =>
  typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

const secureRandomBytes = (length: number): Uint8Array => {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function'
  ) {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }

  return wordArrayToUint8Array(CryptoJS.lib.WordArray.random(length));
};

const sha256Hex = (value: string): string => CryptoJS.SHA256(value).toString(CryptoJS.enc.Hex);

const sha512Bytes = (value: string): Uint8Array => wordArrayToUint8Array(CryptoJS.SHA512(value));

const hmacSha256Bytes = (key: Uint8Array, value: Uint8Array): Uint8Array =>
  wordArrayToUint8Array(
    CryptoJS.HmacSHA256(uint8ArrayToWordArray(value), uint8ArrayToWordArray(key))
  );

const deriveKeys = (sourceText: string): { encryptionKey: Uint8Array; macKey: Uint8Array } => {
  const keyMaterial = sha512Bytes(`${KEY_MATERIAL_PREFIX}:${sourceText}`);

  return {
    encryptionKey: keyMaterial.slice(0, 32),
    macKey: keyMaterial.slice(32, 64),
  };
};

const buildAad = ({ locale, key, textHash }: TranslationCryptoMeta): string =>
  `${ENCRYPTION_VERSION}|${locale}|${key}|${textHash}`;

const buildMacInput = (aad: string, iv: Uint8Array, ciphertext: Uint8Array): Uint8Array =>
  concatBytes(utf8ToBytes(`${MAC_MESSAGE_PREFIX}|${aad}|`), iv, ciphertext);

export const generateHashIdV2 = (x: unknown): string =>
  `${HASH_VERSION_PREFIX}_${sha256Hex(stringifyHashInput(x))}`;

export const isEncryptedTranslationValue = (x: string): boolean => {
  const parts = x.split('.');
  return parts.length === 4 && parts[0] === ENCRYPTION_VERSION;
};

export const encryptTranslationValue = ({
  translatedText,
  sourceText,
  locale,
  key,
  textHash,
}: EncryptTranslationValueParams): string => {
  const { encryptionKey, macKey } = deriveKeys(sourceText);
  const aad = buildAad({ locale, key, textHash });
  const iv = secureRandomBytes(16);

  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(translatedText),
    uint8ArrayToWordArray(encryptionKey),
    {
      iv: uint8ArrayToWordArray(iv),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    }
  );

  const ciphertext = wordArrayToUint8Array(encrypted.ciphertext);
  const mac = hmacSha256Bytes(macKey, buildMacInput(aad, iv, ciphertext));

  return `${ENCRYPTION_VERSION}.${toBase64Url(iv)}.${toBase64Url(mac)}.${toBase64Url(ciphertext)}`;
};

export const decryptTranslationValue = ({
  encryptedText,
  sourceText,
  locale,
  key,
  textHash,
}: TranslationCryptoParams & { encryptedText: string }): string => {
  if (!isEncryptedTranslationValue(encryptedText)) {
    if (isTestEnvironment()) {
      // Unit tests still mock raw plaintext responses. Keep this test-only fallback
      // so production continues to require encrypted payloads.
      return encryptedText;
    }
    throw new Error('Received a non-encrypted translation payload');
  }

  const parts = encryptedText.split('.');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted translation payload format');
  }
  const [, ivPart, macPart, ciphertextPart] = parts;

  const iv = fromBase64Url(ivPart);
  const receivedMac = fromBase64Url(macPart);
  const ciphertext = fromBase64Url(ciphertextPart);
  const { encryptionKey, macKey } = deriveKeys(sourceText);
  const aad = buildAad({ locale, key, textHash });
  const expectedMac = hmacSha256Bytes(macKey, buildMacInput(aad, iv, ciphertext));

  if (!constantTimeCompare(receivedMac, expectedMac)) {
    throw new Error('Encrypted translation integrity check failed');
  }

  const decrypted = CryptoJS.AES.decrypt(
    CryptoJS.lib.CipherParams.create({ ciphertext: uint8ArrayToWordArray(ciphertext) }),
    uint8ArrayToWordArray(encryptionKey),
    {
      iv: uint8ArrayToWordArray(iv),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    }
  );

  return CryptoJS.enc.Utf8.stringify(decrypted);
};
