import { isResourceId, resourcePathFromShortLink } from "@/lib/resource-short-link";
import { stripOrganizationPathname } from "@/lib/organization-path";

/** Only inventory destinations on this instance may be passed to the native app. */
export function nativeAppLink(pageUrl: string): string | null {
  try {
    const page = new URL(pageUrl);
    if (!["https:", "http:"].includes(page.protocol) || page.username || page.password) return null;
    let target = page;
    if (page.pathname === "/login") {
      const callback = page.searchParams.get("callbackUrl");
      if (!callback?.startsWith("/") || callback.startsWith("//")) return null;
      target = new URL(callback, page.origin);
      if (target.origin !== page.origin) return null;
    }
    const path = stripOrganizationPathname(target.pathname);
    const short = /^\/r\/([^/]+)$/.exec(path);
    const resource = /^\/inventory\/([^/]+)(?:\/stock)?$/.exec(path);
    const units = target.searchParams.getAll("unit");
    if (units.length > 1) return null;
    const unit = units[0] ?? null;
    if (short) {
      if (!resourcePathFromShortLink(short[1], unit)) return null;
    } else if (!resource || !isResourceId(resource[1]) || (unit !== null && !isResourceId(unit))) {
      return null;
    }
    // Do not forward unrelated query parameters (tokens, callback URLs, etc.).
    const destination = new URL(target.pathname, page.origin);
    if (unit !== null) destination.searchParams.set("unit", unit);
    if (target.searchParams.get("src") === "qr") destination.searchParams.set("src", "qr");
    return `inventory://open?url=${encodeURIComponent(destination.href)}`;
  } catch {
    return null;
  }
}
