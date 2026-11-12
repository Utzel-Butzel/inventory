import { spoolSnapshotSchema, spoolReceiptSchema } from "@/lib/spool-queue-contract";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { boundedPrintJson } from "@/lib/shared-label-print-contract";
import { printerTelemetrySchema } from "@/lib/printer-status";
import { agentPrinter, printFailure } from "@/lib/shared-label-printing";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const printer = await agentPrinter(request);
    const parsed = z.object({ telemetry: printerTelemetrySchema.optional(), spool: spoolSnapshotSchema.optional(), spoolReceipts: z.array(spoolReceiptSchema).max(20).optional() }).strict().safeParse(await boundedPrintJson(request, 400000));
    if (!parsed.success) return Response.json({ error: "Invalid printer status." }, { status: 400 });
    const body = parsed.data;
    // No client timestamp can extend the lifetime of a device observation.
    body.telemetry
      ? await db.execute(sql`UPDATE label_printers SET last_seen_at=now(),agent_version=2,agent_status=${JSON.stringify(body.telemetry)}::jsonb,status_checked_at=now() WHERE id=${printer.id} RETURNING *`)
      : await db.execute(sql`UPDATE label_printers SET last_seen_at=now(),agent_version=2 WHERE id=${printer.id} RETURNING *`);
    if (body.spool) await db.execute(sql`UPDATE label_printers SET spool_snapshot=${JSON.stringify(body.spool)}::jsonb,spool_checked_at=now() WHERE id=${printer.id}`);
    for (const receipt of body.spoolReceipts ?? []) await db.execute(sql`UPDATE label_spool_commands SET status=${receipt.result} WHERE id=${receipt.id} AND printer_id=${printer.id} AND status IN ('claimed','uncertain',${receipt.result})`);
    const spoolCommands = await db.execute(sql`UPDATE label_spool_commands SET status='claimed' WHERE printer_id=${printer.id} AND status IN ('queued','claimed') AND expires_at>now() RETURNING id,refs,action`);
    await db.execute(sql`DELETE FROM label_spool_commands WHERE printer_id=${printer.id} AND created_at<now()-interval '7 days'`);
    const cancellations = await db.execute(sql`SELECT id,claim_id AS "claimId" FROM label_print_jobs WHERE printer_id=${printer.id} AND status='submitted' AND cancel_requested_at IS NOT NULL AND cancel_result IS NULL AND created_at>now()-interval '10 minutes'`);
    return Response.json({ recheck: !!printer.status_requested_at && (!printer.status_checked_at || new Date(String(printer.status_requested_at)) > new Date(String(printer.status_checked_at))), cancellations, spoolCommands }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return printFailure(error); }
}
