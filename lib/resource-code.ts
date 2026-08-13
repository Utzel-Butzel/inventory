import {
  isResourceId,
  resourceIdFromShortCode,
} from "@/lib/resource-short-link";

const resourceIdFromPath = (segments: string[]) => {
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]?.toLowerCase();
    if (segment === "r") {
      const shortResourceId = resourceIdFromShortCode(segments[index + 1] ?? "");
      if (shortResourceId) return shortResourceId;
    }
    if (!segment || !["inventory", "resource", "resources"].includes(segment)) {
      continue;
    }
    const candidate = segments[index + 1];
    if (candidate && isResourceId(candidate)) return candidate.toLowerCase();
  }
  return null;
};

export type ParsedResourceCode = {
  code: string;
  resourceId: string | null;
};

/**
 * Normalize scanner input and recognize the stable resource links emitted by
 * the web app and native app. Unknown values remain untouched so they can be
 * matched exactly against SKU and serial-number fields.
 */
export function parseResourceCode(value: string): ParsedResourceCode {
  const code = value.trim();
  if (!code) return { code: "", resourceId: null };
  if (isResourceId(code)) {
    return { code, resourceId: code.toLowerCase() };
  }

  const compactMatch = code.match(
    /^inventory:(?:\/\/)?(?:resource\/)?([0-9a-f-]{36})$/i,
  );
  const compactCandidate = compactMatch?.[1];
  if (compactCandidate && isResourceId(compactCandidate)) {
    return { code, resourceId: compactCandidate.toLowerCase() };
  }

  try {
    const url = new URL(code);
    const segments = [url.hostname, ...url.pathname.split("/")]
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
    const pathResourceId = resourceIdFromPath(segments);
    const queryResourceId = [
      url.searchParams.get("resourceId"),
      url.searchParams.get("id"),
    ].find((candidate) => candidate && isResourceId(candidate));
    return {
      code,
      resourceId: pathResourceId ?? queryResourceId?.toLowerCase() ?? null,
    };
  } catch {
    return { code, resourceId: null };
  }
}
