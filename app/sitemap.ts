import type { MetadataRoute } from "next";

const useCases = [
  "makerspace",
  "familie",
  "startup",
  "verein",
  "sammlung",
  "schule",
  "handwerk",
  "labor",
];
const featurePages = [
  "erfassen",
  "strukturieren",
  "bestand-ausleihe",
  "labels-api",
  "orte-raeume",
  "betrieb-sicherheit",
];
const posts = [
  "serienerfassung-in-sekunden",
  "mengenbestand-oder-serialisiert",
  "qr-etiketten-im-makerspace",
  "warum-inventar-selbst-hosten",
  "iphone-lidar-inventarisierung",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.AUTH_URL ?? "http://localhost:3000";
  const routes = [
    "",
    "/features",
    ...featurePages.map((slug) => `/features/${slug}`),
    "/ios",
    "/open-source",
    "/use-cases",
    ...useCases.map((slug) => `/use-cases/${slug}`),
    "/blog",
    ...posts.map((slug) => `/blog/${slug}`),
    "/docs",
    "/api-docs",
    "/impressum",
  ];

  return routes.map((route, index) => ({
    url: new URL(route || "/", baseUrl).toString(),
    changeFrequency: index === 0 ? "weekly" : "monthly",
    priority: index === 0 ? 1 : route === "/features" ? 0.9 : 0.7,
  }));
}
