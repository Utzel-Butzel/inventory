export const ORGANIZATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export function isOrganizationId(value: string) {
  return ORGANIZATION_ID_PATTERN.test(value);
}

export function organizationIdFromPathname(pathname: string) {
  const firstSegment = pathname.split("/").filter(Boolean)[0];
  return firstSegment && isOrganizationId(firstSegment)
    ? firstSegment.toLowerCase()
    : null;
}

export function stripOrganizationPathname(pathname: string) {
  const organizationId = organizationIdFromPathname(pathname);
  if (!organizationId) return pathname || "/";
  const stripped = pathname.slice(organizationId.length + 1);
  return stripped || "/";
}

export function isOrganizationPagePath(pathname: string) {
  const normalized = stripOrganizationPathname(pathname);
  const root = normalized.split("/").filter(Boolean)[0];
  return Boolean(root && ORGANIZATION_ROUTE_ROOTS.has(root));
}

export function organizationPath(organizationId: string, href: string) {
  if (!isOrganizationId(organizationId)) {
    throw new TypeError("Expected a valid organization UUID.");
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

  const normalizedOrganizationId = organizationId.toLowerCase();
  const existingOrganizationId = organizationIdFromPathname(pathname);
  const unscopedHref = existingOrganizationId
    ? pathname.slice(existingOrganizationId.length + 1) || "/"
    : pathname;
  return `/${normalizedOrganizationId}${unscopedHref === "/" ? "/dashboard" : unscopedHref}${suffix}`;
}
