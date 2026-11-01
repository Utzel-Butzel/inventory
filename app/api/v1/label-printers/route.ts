import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSessionPermission } from "@/lib/api-auth";
import { boundedPrintJson, printerCreateSchema } from "@/lib/shared-label-print-contract";
import {
  checkPrintMutation,
  printFailure,
  printHash,
} from "@/lib/shared-label-printing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await requireSessionPermission(request, "labels.read");
  if (auth.response) return auth.response;
  const rows = await db.execute(
    sql`SELECT id,name,kind,location,max_width_mm,max_height_mm,tape_width,enabled,last_seen_at>now()-interval '45 seconds' AS online FROM label_printers WHERE organization_id=${auth.identity.organizationId} AND enabled=true ORDER BY name`,
  );
  return Response.json(
    {
      printers: rows.map((p) => ({
        id: p.id,
        name: p.name, kind: p.kind, location: p.location,
        maxWidthMm: Number(p.max_width_mm), maxHeightMm: Number(p.max_height_mm),
        tape: Number(p.tape_width),
        enabled: p.enabled,
        online: !!p.online,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const auth = await requireSessionPermission(request, "tokens.manage");
  if (auth.response) return auth.response;
  try {
    checkPrintMutation(request, auth.identity);
    const parsed = printerCreateSchema.safeParse(await boundedPrintJson(request, 4096));
    if (!parsed.success)
      return Response.json({ error: "Invalid printer." }, { status: 400 });
    const id = randomUUID(),
      token = "iprt_" + randomBytes(32).toString("base64url");
    await db.execute(
      sql`INSERT INTO label_printers(id,organization_id,name,token_hash,tape_width,kind,location,max_width_mm,max_height_mm) VALUES(${id},${auth.identity.organizationId},${parsed.data.name},${printHash(token)},${parsed.data.tape},${parsed.data.kind},${parsed.data.location},${parsed.data.maxWidthMm},${parsed.data.maxHeightMm})`,
    );
    return Response.json(
      { printer: { id, ...parsed.data }, token },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return printFailure(e);
  }
}
export async function PATCH(request: Request) {
  const auth = await requireSessionPermission(request, "tokens.manage");
  if (auth.response) return auth.response;
  try {
    checkPrintMutation(request, auth.identity);
    const parsed = z
      .object({ id: z.uuid(), enabled: z.literal(false) })
      .strict()
      .safeParse(await boundedPrintJson(request, 1024));
    if (!parsed.success)
      return Response.json(
        { error: "Invalid printer update." },
        { status: 400 },
      );
    const rows = await db.execute(
      sql`UPDATE label_printers SET enabled=false WHERE id=${parsed.data.id} AND organization_id=${auth.identity.organizationId} RETURNING id`,
    );
    if (!rows.length)
      return Response.json({ error: "Printer not found." }, { status: 404 });
    await db.execute(
      sql`UPDATE label_print_jobs SET status='cancelled',payload=NULL,finished_at=now() WHERE printer_id=${parsed.data.id} AND status='queued'`,
    );
    return Response.json({ disabled: true });
  } catch (e) {
    return printFailure(e);
  }
}
