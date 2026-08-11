import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const fallback = process.env.AUTH_URL ?? "http://localhost:3000";
  const metadataBase = new URL(host ? `${protocol}://${host}` : fallback);
  const description =
    "AI-native inventory that turns a photo into a structured record and a clean product cover. MIT licensed, self-hosted, with a native iOS app in the repository.";

  return {
    metadataBase,
    title: {
      default: "Open Inventory",
      template: "%s · Open Inventory",
    },
    description,
    applicationName: "Open Inventory",
    openGraph: {
      type: "website",
      title: "Open Inventory — Take a photo. AI builds the record.",
      description,
      images: [
        {
          url: "/marketing/og-open-inventory-ai.png",
          width: 1200,
          height: 630,
          alt: "Open Inventory — Take a photo. AI builds the record.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Open Inventory — Take a photo. AI builds the record.",
      description,
      images: ["/marketing/og-open-inventory-ai.png"],
    },
  };
}

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f6f7f9",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
