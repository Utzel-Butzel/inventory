import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { inventoryAssignments } from "@/db/schema";
import { db } from "@/lib/db";
import { requireIdentity, requireResourcePermission } from "@/lib/api-auth";
import { getLoanHandovers } from "@/lib/loan-handovers";
import { renderLoanHandoverPdf } from "@/lib/loan-handover-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  const authentication = await requireIdentity(request, "read");
  if (authentication.response) return authentication.response;
  const id = z.string().uuid().safeParse((await context.params).assignmentId);
  if (!id.success) return Response.json({ error: "Invalid assignment id." }, { status: 422 });
  const [assignment] = await db.select({ resourceId: inventoryAssignments.resourceId }).from(inventoryAssignments)
    .where(and(eq(inventoryAssignments.organizationId, authentication.identity.organizationId), eq(inventoryAssignments.id, id.data))).limit(1);
  if (!assignment) return Response.json({ error: "Assignment not found." }, { status: 404 });
  const authorization = await requireResourcePermission(request, "assignments.read", assignment.resourceId);
  if (authorization.response) return authorization.response;
  const documents = await getLoanHandovers(authorization.identity.organizationId, id.data);
  const url = new URL(request.url);
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (url.searchParams.get("format") === "pdf") {
    if (!documents.length) return Response.json({ error: "No handover reports recorded." }, { status: 404, headers });
    const pdf = await renderLoanHandoverPdf(documents, url.searchParams.get("locale") ?? "en");
    return new Response(new Uint8Array(pdf), { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="handover-${id.data}.pdf"` } });
  }
  return Response.json({ documents }, { headers });
}
