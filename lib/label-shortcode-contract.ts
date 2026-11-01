import { z } from "zod";

export const LABEL_SHORTCODE_PATTERN = /^[A-Za-z0-9_-]{8}$/;
export const labelShortcodeRequestSchema = z.object({
  resourceId: z.string().uuid(),
  stockUnitId: z.string().uuid().nullable().optional(),
}).strict();

export const labelShortcodeUrl = (origin: string, code: string) => {
  if (!LABEL_SHORTCODE_PATTERN.test(code)) throw new TypeError("Invalid label shortcode.");
  return `${origin.replace(/\/$/, "")}/q/${code}`;
};

/** Only explicit shortcode URLs are resolved; bare values remain SKU/barcode input. */
export function labelShortcodeFromUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const match = /^\/q\/([A-Za-z0-9_-]{8})$/.exec(url.pathname);
    return match?.[1] ?? null;
  } catch { return null; }
}

export function labelQrDestination(resourceId: string, stockUnitId: string | null) {
  const query = new URLSearchParams();
  if (stockUnitId) query.set("unit", stockUnitId);
  query.set("src", "qr");
  return `/inventory/${resourceId}${stockUnitId ? "/stock" : ""}?${query}`;
}
