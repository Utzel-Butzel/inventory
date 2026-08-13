import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

function encryptionKey(variableName: string) {
  const configured = process.env[variableName]?.trim();
  if (!configured) {
    throw new Error(`${variableName} is not configured.`);
  }
  if (/^[0-9a-f]{64}$/i.test(configured)) {
    return Buffer.from(configured, "hex");
  }
  try {
    const decoded = Buffer.from(configured, "base64url");
    if (decoded.length === 32) return decoded;
  } catch {
    // The actionable validation error below is shared by every accepted format.
  }
  throw new Error(
    `${variableName} must be exactly 32 random bytes encoded as base64url or 64 hexadecimal characters.`,
  );
}

export function encryptSecret(value: string, variableName: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(variableName), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSecret(value: string, variableName: string) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw new Error("Unsupported encrypted value.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(variableName),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
