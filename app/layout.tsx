import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";

import { UI_LANGUAGE_HEADER, UI_LANGUAGES } from "@/i18n.config";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const fallback = process.env.AUTH_URL ?? "http://localhost:3000";
  const metadataBase = new URL(host ? `${protocol}://${host}` : fallback);
  const locale = requestHeaders.get(UI_LANGUAGE_HEADER) === "de" ? "de" : "en";
  const description = locale === "de"
    ? "Die selbst gehostete Open-Inventory-Web-App."
    : "The self-hosted Open Inventory web app.";

  return {
    metadataBase,
    title: {
      default: "Open Inventory",
      template: "%s · Open Inventory",
    },
    description,
    applicationName: "Open Inventory",
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0c10" },
  ],
};

const themeInitScript = `
let theme = null;
try {
  theme = localStorage.getItem("inventory-theme");
} catch {}
if (theme === "light" || theme === "dark") {
  document.documentElement.dataset.theme = theme;
}
const resolvedTheme = theme === "light" || theme === "dark"
  ? theme
  : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
  meta.setAttribute("content", resolvedTheme === "dark" ? "#0a0c10" : "#f6f7f9");
});
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const requestedLanguage = requestHeaders.get(UI_LANGUAGE_HEADER) ?? "en";
  const language = UI_LANGUAGES.includes(requestedLanguage as "en" | "de")
    ? requestedLanguage
    : "en";

  return (
    <html lang={language} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
