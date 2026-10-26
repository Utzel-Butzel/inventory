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
        status: z.enum(["submitted", "failed", "uncertain"]),
        spoolJobId: z.number().int().positive().nullable().default(null),
      })
      .strict()
      .safeParse(await boundedPrintJson(request, 2048));
    if (!parsed.success)
      return Response.json({ error: "Invalid receipt." }, { status: 400 });
    const p = parsed.data;
    const rows = await db.execute(
      sql`UPDATE label_print_jobs SET status=${p.status},spool_job_id=${p.spoolJobId},payload=NULL,finished_at=now() WHERE id=${p.id} AND printer_id=${printer.id} AND claim_id=${p.claimId} AND status IN ('claimed','uncertain',${p.status}) RETURNING id`,
    );
    return rows.length
      ? Response.json({ ok: true })
      : Response.json({ error: "Claim not found." }, { status: 409 });
  } catch (e) {
    return printFailure(e);
  }
}
