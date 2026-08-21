export const ORGANIZATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ORGANIZATION_SLUG_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

export const ORGANIZATION_SLUG_MAX_LENGTH = 48;
export const ORGANIZATION_ROUTE_SLUG_MAX_LENGTH = 80;

export const ORGANIZATION_ROUTE_ROOTS = new Set([
  "dashboard",
  "inventory",
  "stock",
  "map",
  "spaces",
  "batch",
  "labels",
  "duplicates",
  "notifications",
  "settings",
]);

// These top-level paths must stay available before a workspace is selected.
// App page roots are intentionally not reserved: the migrated default
// organization is named `inventory` and remains addressable at
// `/inventory/dashboard` and `/inventory/inventory`.
export const RESERVED_ORGANIZATION_SLUGS = new Set([
  "api",
  "login",
  "r",
  "share",
]);

export function isOrganizationId(value: string) {
  return ORGANIZATION_ID_PATTERN.test(value);
}

export function isOrganizationSlug(value: string) {
  const normalized = value.toLowerCase();
  return (
    normalized.length >= 1 &&
    normalized.length <= ORGANIZATION_ROUTE_SLUG_MAX_LENGTH &&
    ORGANIZATION_SLUG_PATTERN.test(normalized) &&
    !isOrganizationId(normalized) &&
    !RESERVED_ORGANIZATION_SLUGS.has(normalized)
  );
}

export function isOrganizationReference(value: string) {
  return isOrganizationId(value) || isOrganizationSlug(value);
}

export function slugifyOrganizationName(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ORGANIZATION_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
  const candidate = normalized || "organization";
  return RESERVED_ORGANIZATION_SLUGS.has(candidate) || isOrganizationId(candidate)
    ? `${candidate}-org`
    : candidate;
}

/** Returns the UUID or slug in the first URL segment, without resolving it. */
export function organizationReferenceFromPathname(pathname: string) {
  const firstSegment = pathname.split("/").filter(Boolean)[0];
  return firstSegment && isOrganizationReference(firstSegment)
    ? firstSegment.toLowerCase()
    : null;
}

/** Kept for callers that specifically need to recognize a legacy UUID URL. */
export function organizationIdFromPathname(pathname: string) {
  const reference = organizationReferenceFromPathname(pathname);
  return reference && isOrganizationId(reference) ? reference : null;
}

/**
 * Returns the internal app path only when the pathname is unambiguously
 * organization-scoped. A single app root such as `/inventory` remains a
 * legacy unscoped path; `/inventory/dashboard` can still use `inventory` as
 * an organization slug.
 */
export function organizationPagePathFromPathname(pathname: string) {
  const organizationReference = organizationReferenceFromPathname(pathname);
  if (!organizationReference) return null;
  const stripped = pathname.slice(organizationReference.length + 1) || "/";
  if (stripped === "/") {
    return isOrganizationId(organizationReference) ||
      !ORGANIZATION_ROUTE_ROOTS.has(organizationReference)
      ? "/"
      : null;
  }
  const root = stripped.split("/").filter(Boolean)[0];
  return root && ORGANIZATION_ROUTE_ROOTS.has(root) ? stripped : null;
}

export function stripOrganizationPathname(pathname: string) {
  return organizationPagePathFromPathname(pathname) ?? (pathname || "/");
}

export function isOrganizationScopedPagePath(pathname: string) {
  return organizationPagePathFromPathname(pathname) !== null;
}

export function isOrganizationPagePath(pathname: string) {
  const rawRoot = pathname.split("/").filter(Boolean)[0];
  return Boolean(
    (rawRoot && ORGANIZATION_ROUTE_ROOTS.has(rawRoot)) ||
      isOrganizationScopedPagePath(pathname),
  );
}

export function organizationPath(organizationReference: string, href: string) {
  if (!isOrganizationReference(organizationReference)) {
    throw new TypeError("Expected a valid organization slug or UUID.");
  }
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const suffixIndex = href.search(/[?#]/);
  const pathname = suffixIndex >= 0 ? href.slice(0, suffixIndex) : href;
  const suffix = suffixIndex >= 0 ? href.slice(suffixIndex) : "";
  if (
    pathname === "/login" ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/share" ||
    pathname.startsWith("/share/") ||
    pathname === "/r" ||
    pathname.startsWith("/r/") ||
    pathname === "/_next" ||
    pathname.startsWith("/_next/")
  ) {
    return href;
  }

  const normalizedReference = organizationReference.toLowerCase();
  const existingPagePath = organizationPagePathFromPathname(pathname);
  const unscopedHref = existingPagePath ?? pathname;
  return `/${normalizedReference}${unscopedHref === "/" ? "/inventory" : unscopedHref}${suffix}`;
}
