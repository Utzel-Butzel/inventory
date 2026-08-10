import type { Metadata } from "next";

import { StockScanner } from "@/components/stock-scanner";
import { getSessionIdentity } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Scan stock | Inventory",
  description: "Scan QR codes and apply configured properties to stock units.",
};

export default async function StockScanPage() {
  const identity = await getSessionIdentity();

  return <StockScanner canExecute={Boolean(identity && identity.role !== "viewer")} />;
}
