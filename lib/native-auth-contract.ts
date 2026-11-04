import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const NATIVE_AUTH_CALLBACK = "de.polyxo.openinventory://auth/callback";
export const NATIVE_AUTH_TTL_MS = 10 * 60_000;
export const NATIVE_CODE_TTL_MS = 60_000;
export const nativeSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const nativeStartSchema = z.object({
  codeChallenge: nativeSecretSchema,
  codeChallengeMethod: z.literal("S256"),
  state: nativeSecretSchema,
  deviceName: z.string().trim().min(1).max(80).default("iOS"),
}).strict();
export const nativeExchangeSchema = z.object({
  requestId: nativeSecretSchema,
  code: nativeSecretSchema,
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
}).strict();

export const nativeSecret = () => randomBytes(32).toString("base64url");
export const nativeHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const nativeChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
export const equalNativeSecret = (left: string, right: string) =>
  timingSafeEqual(Buffer.from(nativeHash(left), "hex"), Buffer.from(nativeHash(right), "hex"));

export function nativeCallback(state: string, result: { code: string } | { error: "access_denied" }) {
  const url = new URL(NATIVE_AUTH_CALLBACK);
  url.searchParams.set("state", state);
  if ("code" in result) url.searchParams.set("code", result.code);
  else url.searchParams.set("error", result.error);
  return url.href;
}

export function nativeBrowserCookie(requestId: string, secure: boolean) {
  return `${secure ? "__Host-" : ""}inventory-native-${requestId.slice(0, 16)}`;
}

export function safeLoginCallback(value: string | string[] | undefined, fallback = "/inventory") {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate?.startsWith("/") || /[\\\u0000-\u0020]/.test(candidate)) return fallback;
  const origin = "https://inventory.invalid";
  const parsed = new URL(candidate, origin);
  return parsed.origin === origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
}
