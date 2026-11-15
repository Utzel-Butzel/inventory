import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSessionPermission } from "@/lib/api-auth";
import { boundedPrintJson } from "@/lib/shared-label-print-contract";
import {
  checkPrintMutation,
  cancelSharedPrint,
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
  await db.execute(sql`UPDATE label_print_jobs SET status='uncertain',cancel_result='uncertain',payload=NULL,finished_at=now() WHERE organization_id=${auth.identity.organizationId} AND created_by=${auth.identity.subject} AND cancel_requested_at IS NOT NULL AND cancel_result IS NULL AND ((status='claimed' AND claimed_at<now()-interval '5 minutes') OR (status='submitted' AND created_at<now()-interval '10 minutes'))`);
  const rows = await db.execute(
    sql`SELECT j.*,p.name AS printer_name FROM label_print_jobs j JOIN label_printers p ON p.id=j.printer_id WHERE j.organization_id=${auth.identity.organizationId} AND j.created_by=${auth.identity.subject} ORDER BY j.created_at DESC LIMIT 20`,
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
    const job = await cancelSharedPrint(auth.identity, parsed.data.id);
    return Response.json({ job, cancelled: job.status === "cancelled" });
  } catch (e) {
    return printFailure(e);
  }
}
