import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireSessionPermission } from "@/lib/api-auth";
import { boundedPrintJson } from "@/lib/shared-label-print-contract";
import { checkPrintMutation, printFailure } from "@/lib/shared-label-printing";
export async function POST(request: Request) {
  const auth = await requireSessionPermission(request, "labels.read");
  if (auth.response) return auth.response;
  try {
    checkPrintMutation(request, auth.identity);
    const parsed = z.object({ id: z.uuid() }).strict().safeParse(await boundedPrintJson(request, 1024));
    if (!parsed.success) return Response.json({ error: "Invalid printer." }, { status: 400 });
    const { id } = parsed.data;
    const rows = await db.execute(sql`UPDATE label_printers SET status_requested_at=now() WHERE id=${id} AND organization_id=${auth.identity.organizationId} AND enabled=true AND (status_requested_at IS NULL OR status_requested_at<now()-interval '10 seconds') RETURNING id`);
    return Response.json({ requested: !!rows.length });
  } catch (error) { return printFailure(error); }
}
