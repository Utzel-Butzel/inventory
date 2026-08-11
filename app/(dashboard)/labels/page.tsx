import type { Metadata } from "next";

import { LabelPrinter } from "@/components/label-printer";

export const metadata: Metadata = {
  title: "Labels",
  description: "Create and print QR and barcode labels for inventory items.",
};

export const dynamic = "force-dynamic";

export default function LabelsPage() {
  return <LabelPrinter />;
}
