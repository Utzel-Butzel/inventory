import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSessionPermission } from "@/lib/api-auth";
import { boundedPrintJson } from "@/lib/shared-label-print-contract";
import {
  checkPrintMutation,
  enqueueSharedPrint,
  jobDto,
  printFailure,
} from "@/lib/shared-label-printing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await requireSessionPermission(request, "labels.read");
  if (auth.response) return auth.response;
  await db.execute(
    sql`UPDATE label_print_jobs SET status='expired',payload=NULL,finished_at=now() WHERE organization_id=${auth.identity.organizationId} AND created_by=${auth.identity.subject} AND status='queued' AND expires_at<now()`,
  );
  const rows = await db.execute(
    sql`SELECT id,printer_id,label_count,status,created_at,spool_job_id FROM label_print_jobs WHERE organization_id=${auth.identity.organizationId} AND created_by=${auth.identity.subject} ORDER BY created_at DESC LIMIT 20`,
  );
  return Response.json(
    { jobs: rows.map(jobDto) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const auth = await requireSessionPermission(request, "labels.read");
  if (auth.response) return auth.response;
  try {
    checkPrintMutation(request, auth.identity);
    return Response.json(
      {
        job: await enqueueSharedPrint(
          auth.identity,
          await boundedPrintJson(request),
        ),
      },
      { status: 201 },
    );
  } catch (e) {
    return printFailure(e);
  }
}
export async function DELETE(request: Request) {
  const auth = await requireSessionPermission(request, "labels.read");
  if (auth.response) return auth.response;
  try {
    checkPrintMutation(request, auth.identity);
    const parsed = z
      .object({ id: z.uuid() })
      .strict()
      .safeParse(await boundedPrintJson(request, 1024));
    if (!parsed.success)
      return Response.json({ error: "Invalid job." }, { status: 400 });
    const rows = await db.execute(
      sql`UPDATE label_print_jobs SET status='cancelled',payload=NULL,finished_at=now() WHERE id=${parsed.data.id} AND organization_id=${auth.identity.organizationId} AND created_by=${auth.identity.subject} AND status='queued' RETURNING id`,
    );
    return rows.length
      ? Response.json({ cancelled: true })
      : Response.json(
          { error: "Job is already dispatched or not found." },
          { status: 409 },
        );
  } catch (e) {
    return printFailure(e);
  }
}
