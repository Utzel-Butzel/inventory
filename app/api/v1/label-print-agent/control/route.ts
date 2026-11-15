import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { boundedPrintJson } from "@/lib/shared-label-print-contract";
import { agentPrinter, controlSharedPrint, printFailure } from "@/lib/shared-label-printing";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const printer = await agentPrinter(request);
    const parsed = z.object({ id: z.uuid(), claimId: z.uuid(), action: z.enum(["check", "start"]) }).strict().safeParse(await boundedPrintJson(request, 1024));
    if (!parsed.success) return Response.json({ error: "Invalid control request." }, { status: 400 });
    const body = parsed.data;
    const result = await controlSharedPrint(String(printer.id), body.id, body.claimId, body.action);
    await db.execute(sql`UPDATE label_printers SET last_seen_at=now(),agent_status=CASE WHEN ${result.mayPrint} AND agent_status IS NOT NULL THEN agent_status || '{"state":"busy","tape":null}'::jsonb ELSE agent_status END WHERE id=${printer.id}`);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return printFailure(error); }
}
