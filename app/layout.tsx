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
    "An AI-assisted inventory and stock workspace with traceable movements, serialized units, and replenishment forecasts.";

  return {
    metadataBase,
    title: {
      default: "Inventory",
      template: "%s · Inventory",
    },
    description,
    applicationName: "Inventory",
    openGraph: {
      type: "website",
      title: "Inventory · Everything, findable.",
      description,
      images: [
        {
          url: "/og.png",
          width: 1200,
          height: 630,
          alt: "Inventory — Everything, findable.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Inventory · Everything, findable.",
      description,
      images: ["/og.png"],
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
