import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSessionPermission } from "@/lib/api-auth";
import { boundedPrintJson } from "@/lib/shared-label-print-contract";
import { spoolSnapshotSchema, spoolOperationSchema } from "@/lib/spool-queue-contract";
import { checkPrintMutation, printFailure, PrintFailure } from "@/lib/shared-label-printing";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const auth = await requireSessionPermission(request, "tokens.manage");
  if (auth.response) return auth.response;
  const id = z.uuid().safeParse(new URL(request.url).searchParams.get("printerId"));
  if (!id.success) return Response.json({ error: "Invalid printer." }, { status: 400 });
  const [printer] = await db.execute(sql`SELECT spool_snapshot,spool_checked_at,last_seen_at FROM label_printers WHERE id=${id.data} AND organization_id=${auth.identity.organizationId} AND enabled=true`);
  if (!printer) return Response.json({ error: "Printer not found." }, { status: 404 });
  await db.execute(sql`UPDATE label_spool_commands SET status=CASE WHEN status='queued' THEN 'expired' ELSE 'uncertain' END WHERE printer_id=${id.data} AND status IN ('queued','claimed') AND expires_at<now()`);
  const commands = await db.execute(sql`SELECT id,status,action,created_at FROM label_spool_commands WHERE printer_id=${id.data} ORDER BY created_at DESC LIMIT 5`);
  const fresh = !!printer.spool_checked_at && !!printer.last_seen_at && Date.now()-new Date(String(printer.spool_checked_at)).getTime()<45000 && Date.now()-new Date(String(printer.last_seen_at)).getTime()<45000;
  return Response.json({ snapshot: printer.spool_snapshot, checkedAt: printer.spool_checked_at, fresh, commands }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const auth = await requireSessionPermission(request, "tokens.manage");
  if (auth.response) return auth.response;
  try {
    checkPrintMutation(request, auth.identity);
    const input = spoolOperationSchema.safeParse(await boundedPrintJson(request, 16000));
    if (!input.success) return Response.json({ error: "Invalid queue operation." }, { status: 400 });
    const result = await db.transaction(async tx => {
      const [p] = await tx.execute(sql`SELECT * FROM label_printers WHERE id=${input.data.printerId} AND organization_id=${auth.identity.organizationId} AND enabled=true FOR UPDATE`);
      const snapshot = spoolSnapshotSchema.safeParse(p?.spool_snapshot);
      if (!p || !snapshot.success || !snapshot.data.supported || !p.spool_checked_at || !p.last_seen_at || Date.now()-new Date(String(p.spool_checked_at)).getTime()>45000 || Date.now()-new Date(String(p.last_seen_at)).getTime()>45000) throw new PrintFailure("Queue unavailable or stale. Refresh first.",409);
      if (input.data.action !== "cancel" && !snapshot.data.actions?.includes(input.data.action)) throw new PrintFailure("Update the print agent to control jobs.",409);
      if (!input.data.refs.every(ref => snapshot.data.jobs.some(j => j.ref===ref))) throw new PrintFailure("Queue changed. Refresh first.",409);
      const [active] = await tx.execute(sql`SELECT id FROM label_spool_commands WHERE printer_id=${p.id} AND status IN ('queued','claimed') AND expires_at>now()`);
      if (active) throw new PrintFailure("A queue operation is already pending.",409);
      const id=randomUUID();
      await tx.execute(sql`INSERT INTO label_spool_commands(id,printer_id,action,refs,created_by) VALUES(${id},${p.id},${input.data.action},${JSON.stringify([...new Set(input.data.refs)])}::jsonb,${auth.identity.subject})`);
      return {id,status:"queued",action:input.data.action};
    });
    return Response.json(result,{status:202});
  } catch(error) { return printFailure(error); }
}
