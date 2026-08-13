const RESOURCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BASE64_URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const encodeBytes = (bytes: Uint8Array) => {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset];
    const second = bytes[offset + 1];
    const third = bytes[offset + 2];

    output += BASE64_URL_ALPHABET[first >> 2];
    output += BASE64_URL_ALPHABET[
      ((first & 0b11) << 4) | (second === undefined ? 0 : second >> 4)
    ];
    if (second === undefined) break;

    output += BASE64_URL_ALPHABET[
      ((second & 0b1111) << 2) | (third === undefined ? 0 : third >> 6)
    ];
    if (third === undefined) break;

    output += BASE64_URL_ALPHABET[third & 0b111111];
  }
  return output;
};

const decodeBytes = (value: string) => {
  if (!/^[A-Za-z0-9_-]{22}$/.test(value)) return null;

  const bytes: number[] = [];
  let accumulator = 0;
  let bitCount = 0;
  for (const character of value) {
    const digit = BASE64_URL_ALPHABET.indexOf(character);
    if (digit < 0) return null;
    accumulator = accumulator * 64 + digit;
    bitCount += 6;

    while (bitCount >= 8) {
      bitCount -= 8;
      const divisor = 2 ** bitCount;
      bytes.push(Math.floor(accumulator / divisor));
      accumulator %= divisor;
    }
  }

  // A 128-bit UUID occupies 22 base64url characters. The final four padding
  // bits are implicit and must be zero for the representation to be canonical.
  return bytes.length === 16 && accumulator === 0
    ? new Uint8Array(bytes)
    : null;
};

export const isResourceId = (value: string) =>
  RESOURCE_ID_PATTERN.test(value);

/** Encode an RFC 4122 resource UUID as an unpadded 22-character base64url id. */
export function resourceShortCode(resourceId: string) {
  if (!isResourceId(resourceId)) {
    throw new TypeError("Expected a valid resource UUID.");
  }
  const hex = resourceId.replaceAll("-", "").toLowerCase();
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return encodeBytes(bytes);
}

/** Decode a canonical compact id, returning null for malformed resource ids. */
export function resourceIdFromShortCode(code: string) {
  const bytes = decodeBytes(code);
  if (!bytes) return null;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const resourceId = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");

  if (!isResourceId(resourceId)) return null;
  return resourceShortCode(resourceId) === code ? resourceId : null;
}

export const resourceShortPath = (resourceId: string) =>
  `/r/${resourceShortCode(resourceId)}`;

export const resourceShortUrl = (origin: string, resourceId: string) => {
  const path = resourceShortPath(resourceId);
  return origin ? `${origin.replace(/\/$/, "")}${path}` : path;
};
