import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  UI_LANGUAGE_COOKIE,
  UI_LANGUAGE_HEADER,
  UI_LANGUAGES,
  type UiLanguage,
} from "./i18n.config";
import {
  isOrganizationId,
  isOrganizationPagePath,
  organizationIdFromPathname,
  organizationPath,
  stripOrganizationPathname,
} from "./lib/organization-path";

const ORGANIZATION_COOKIE = "inventory.organization";
const ORGANIZATION_HEADER = "x-organization-id";
const ORIGINAL_PATH_HEADER = "x-inventory-original-path";

function requestedLanguage(request: NextRequest): UiLanguage {
  const cookieLanguage = request.cookies.get(UI_LANGUAGE_COOKIE)?.value;
  if (UI_LANGUAGES.includes(cookieLanguage as UiLanguage)) {
    return cookieLanguage as UiLanguage;
  }

  const requested = (request.headers.get("accept-language") ?? "")
    .split(",")
    .map((part) => {
      const [language, quality] = part.trim().split(";");
      return {
        language: language.toLowerCase().split("-")[0],
        quality: quality?.startsWith("q=") ? Number(quality.slice(2)) : 1,
      };
    })
    .filter((part) => Number.isFinite(part.quality))
    .sort((left, right) => right.quality - left.quality);
  return (
    requested.find((part) =>
      UI_LANGUAGES.includes(part.language as UiLanguage),
    )?.language as UiLanguage | undefined
  ) ?? "en";
}

function routedHeaders(request: NextRequest, organizationId?: string | null) {
  const headers = new Headers(request.headers);
  headers.set(UI_LANGUAGE_HEADER, requestedLanguage(request));
  headers.set(
    ORIGINAL_PATH_HEADER,
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  if (organizationId) headers.set(ORGANIZATION_HEADER, organizationId);
  return headers;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const routeOrganizationId = organizationIdFromPathname(pathname);
  const internalPathname = stripOrganizationPathname(pathname);
  const routedOrganizationId = request.headers.get(ORGANIZATION_HEADER)?.trim();

  if (
    routeOrganizationId &&
    (internalPathname === "/" || isOrganizationPagePath(pathname))
  ) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname =
      internalPathname === "/" ? "/dashboard" : internalPathname;
    const response = NextResponse.rewrite(rewriteUrl, {
      request: { headers: routedHeaders(request, routeOrganizationId) },
    });
    response.cookies.set(ORGANIZATION_COOKIE, routeOrganizationId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
    return response;
  }

  // Rewrites of organization-scoped URLs pass through this proxy again with
  // the tenant header already attached. Do not canonicalize that internal
  // route back to the same public URL or it becomes a redirect loop.
  if (isOrganizationPagePath(pathname) && !routedOrganizationId) {
    const cookieOrganizationId = request.cookies.get(ORGANIZATION_COOKIE)?.value;
    if (cookieOrganizationId && isOrganizationId(cookieOrganizationId)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = organizationPath(cookieOrganizationId, pathname);
      return NextResponse.redirect(redirectUrl);
    }
  }

  return NextResponse.next({ request: { headers: routedHeaders(request) } });
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/share/:path*",
    "/dashboard/:path*",
    "/inventory/:path*",
    "/stock/:path*",
    "/map/:path*",
    "/spaces/:path*",
    "/batch/:path*",
    "/labels/:path*",
    "/duplicates/:path*",
    "/notifications/:path*",
    "/settings/:path*",
    "/:organizationId/:path*",
  ],
};
