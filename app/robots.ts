import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.AUTH_URL ?? "http://localhost:3000";

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/features", "/ios", "/open-source", "/use-cases/", "/blog/", "/docs", "/api-docs"],
      disallow: ["/dashboard", "/inventory", "/stock", "/settings", "/login"],
    },
    sitemap: new URL("/sitemap.xml", baseUrl).toString(),
  };
}
