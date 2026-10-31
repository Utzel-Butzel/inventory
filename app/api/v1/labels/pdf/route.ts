import { requireSessionPermission } from "@/lib/api-auth";
import { boundedPrintJson } from "@/lib/shared-label-print-contract";
import { labelDocumentSchema, LABEL_DOCUMENT_LIMIT } from "@/lib/label-document";
import { createLabelPdf } from "@/lib/label-document-pdf";
import { PrintFailure, printFailure } from "@/lib/shared-label-printing";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const auth = await requireSessionPermission(request, "labels.read");
  if (auth.response) return auth.response;
  try {
    const parsed = labelDocumentSchema.safeParse(await boundedPrintJson(request, LABEL_DOCUMENT_LIMIT));
    if (!parsed.success) throw new PrintFailure("Invalid print document.", 422);
    let pdf: Buffer;
    try { pdf = await createLabelPdf(parsed.data); }
    catch { throw new PrintFailure("The labels do not fit the selected paper or contain invalid images.", 422); }
    return new Response(new Uint8Array(pdf), { headers: {
      "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="inventory-labels.pdf"', "Cache-Control": "no-store",
    } });
  } catch (error) { return printFailure(error); }
}
