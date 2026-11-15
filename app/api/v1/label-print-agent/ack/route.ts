import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { boundedPrintJson } from "@/lib/shared-label-print-contract";
import { agentPrinter, printFailure } from "@/lib/shared-label-printing";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const printer = await agentPrinter(request);
    const parsed = z
      .object({
        id: z.uuid(),
        claimId: z.uuid(),
        status: z.enum(["submitted", "completed", "failed", "uncertain", "cancelled"]),
        cancelResult: z.enum(["cancelled", "stopped", "uncertain", "too_late", "unsupported"]).nullable().default(null),
        spoolJobId: z.number().int().positive().nullable().default(null),
      })
      .strict()
      .safeParse(await boundedPrintJson(request, 2048));
    if (!parsed.success)
      return Response.json({ error: "Invalid receipt." }, { status: 400 });
    const p = parsed.data;
    const rows = await db.execute(
      sql`UPDATE label_print_jobs SET status=${p.status},spool_job_id=${p.spoolJobId},cancel_result=COALESCE(${p.cancelResult},CASE WHEN cancel_requested_at IS NOT NULL THEN CASE WHEN ${p.status}='completed' THEN 'too_late' WHEN ${p.status} IN ('uncertain','failed') THEN 'uncertain' WHEN ${p.status}='submitted' AND ${p.spoolJobId}::integer IS NULL THEN 'unsupported' ELSE cancel_result END ELSE cancel_result END),payload=NULL,finished_at=now()
      WHERE id=${p.id} AND printer_id=${printer.id} AND claim_id=${p.claimId}
      AND (status IN ('claimed','uncertain',${p.status}) OR (status='submitted' AND cancel_requested_at IS NOT NULL AND ${p.cancelResult}::text IS NOT NULL))
      AND (${p.status}!='cancelled' OR (cancel_requested_at IS NOT NULL AND dispatch_started_at IS NULL)) RETURNING id`,
    );
    return rows.length
      ? Response.json({ ok: true })
      : Response.json({ error: "Claim not found." }, { status: 409 });
  } catch (e) {
    return printFailure(e);
  }
}
