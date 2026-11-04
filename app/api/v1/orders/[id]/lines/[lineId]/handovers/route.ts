import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { orderLines, orders } from "@/db/schema";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/api-auth";
import { getOrderLoanHandovers } from "@/lib/order-loan-handovers";
import { renderLoanHandoverPdf } from "@/lib/loan-handover-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string; lineId: string }> }) {
  const authorization = await requirePermission(request, "orders.read");
  if (authorization.response) return authorization.response;
  const { id, lineId } = await context.params;
  const url = new URL(request.url);
  const unitId = url.searchParams.get("unitId");
  if (![id, lineId, ...(unitId ? [unitId] : [])].every((value) => z.string().uuid().safeParse(value).success)) {
    return Response.json({ error: "Invalid order, line or unit id." }, { status: 422 });
  }
  const organizationId = authorization.identity.organizationId;
  const [line] = await db.select({ id: orderLines.id }).from(orderLines)
    .innerJoin(orders, and(eq(orders.organizationId, organizationId), eq(orders.id, orderLines.orderId), eq(orders.type, "loan")))
    .where(and(eq(orderLines.organizationId, organizationId), eq(orderLines.id, lineId), eq(orderLines.orderId, id))).limit(1);
  if (!line) return Response.json({ error: "Loan line not found." }, { status: 404 });
  const documents = await getOrderLoanHandovers(organizationId, lineId, unitId ?? undefined);
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (url.searchParams.get("format") === "pdf") {
    if (!documents.length) return Response.json({ error: "No handover reports recorded." }, { status: 404, headers });
    const pdf = await renderLoanHandoverPdf(documents, url.searchParams.get("locale") ?? "en");
    return new Response(new Uint8Array(pdf), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="handover-${lineId}.pdf"` } });
  }
  return Response.json({ documents }, { headers });
}
