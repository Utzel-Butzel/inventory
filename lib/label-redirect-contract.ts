import { z } from "zod";

export const labelQrRedirectUrlSchema = z.string().trim().max(2048).refine(value => {
  if (!value) return true;
  if (!/^https?:\/\//i.test(value) || /[\\\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}, "Enter a complete HTTP or HTTPS URL without credentials.")
  .transform(value => value ? new URL(value).href : null).nullable();

/** Only the saved setting controls external redirects; scan parameters are never forwarded. */
export function labelExternalDestination(value: unknown, requestUrl: string) {
  const parsed = labelQrRedirectUrlSchema.safeParse(value);
  if (!parsed.success || !parsed.data) return null;
  const destination = new URL(parsed.data);
  // An inventory redirect endpoint on this instance would create a redirect loop.
  if (destination.origin === new URL(requestUrl).origin && /^\/(?:r|q)(?:\/|$)/.test(destination.pathname)) return null;
  destination.searchParams.set("src", "qr");
  return destination.href;
}
