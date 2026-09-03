import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";

import { UI_LANGUAGE_HEADER, UI_LANGUAGES } from "@/i18n.config";

import "@mdxeditor/editor/style.css";
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
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "Open Inventory",
    },
    formatDetection: { telephone: false },
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0c10" },
  ],
};

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
  const savedTheme = (await cookies()).get("inventory-theme")?.value;
  const theme = savedTheme === "light" || savedTheme === "dark"
    ? savedTheme
    : undefined;

  return (
    <html lang={language} data-theme={theme} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
