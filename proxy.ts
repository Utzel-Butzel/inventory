import { createProxy } from "next-i18next/proxy";

import i18nConfig from "./i18n.config";

export const proxy = createProxy(i18nConfig);

export const config = {
  matcher: [
    "/login",
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
    "/share/:path*",
  ],
};
