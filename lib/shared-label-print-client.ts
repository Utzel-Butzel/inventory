import { fetchJson } from "@/lib/client-types";
import type { SharedPrintJob } from "@/lib/shared-label-print-contract";
import type { LabelDocument } from "@/lib/label-document";
let pending: { fingerprint: string; id: string } | undefined;
export async function sendSharedLabels(
  printerId: string,
  tape: number,
  data: Uint8Array[],
) {
  const labels = data.map((bytes) => {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  });
  return sendPrintContent({ printerId, tape, labels });
}
export async function sendSharedDocument(printerId: string, document: LabelDocument) {
  return sendPrintContent({ printerId, format: "pdf", document });
}
async function sendPrintContent(value: object) {
  const content = JSON.stringify(value);
  const fingerprint = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // An explicit retry after a lost HTTP response reuses the same request ID.
  // The server returns the existing job rather than printing it twice.
  if (pending?.fingerprint !== fingerprint)
    pending = { fingerprint, id: crypto.randomUUID() };
  const result = await fetchJson<{ job: SharedPrintJob }>(
    "/api/v1/label-print-jobs",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...JSON.parse(content), id: pending.id }),
    },
  );
  pending = undefined;
  return result.job;
}
