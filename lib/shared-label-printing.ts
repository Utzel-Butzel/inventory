import "server-only";
import { createLabelPdf } from "@/lib/label-document-pdf";
import { layoutLabelPages } from "@/lib/label-document";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { RequestIdentity } from "@/lib/api-auth";
import {
  PrintBodyError,
  sharedPrintSchema,
  validateSharedRasters,
} from "@/lib/shared-label-print-contract";

export class PrintFailure extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export const printHash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const printFailure = (error: unknown) =>
  Response.json(
    {
      error:
        error instanceof PrintFailure || error instanceof PrintBodyError
          ? error.message
          : "Unable to process print request.",
    },
    {
      status:
        error instanceof PrintFailure || error instanceof PrintBodyError
          ? error.status
          : 500,
    },
  );
export const jobDto = (row: Record<string, unknown>) => ({
  id: row.id,
  printerId: row.printer_id,
  count: row.label_count,
  status: row.status,
  createdAt: row.created_at,
  spoolJobId: row.spool_job_id ?? null,
});
export function checkPrintMutation(
  request: Request,
  identity: RequestIdentity,
) {
  if (identity.organization.isReadOnly)
    throw new PrintFailure(
      "Printing is disabled in read-only organizations.",
      403,
    );
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new PrintFailure("Cross-site printing is not allowed.", 403);
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.AUTH_URL || request.url).origin;
  if (origin && origin !== expected)
    throw new PrintFailure("Invalid print origin.", 403);
}
export async function enqueueSharedPrint(
  identity: RequestIdentity,
  value: unknown,
) {
  const parsed = sharedPrintSchema.safeParse(value);
  if (!parsed.success) throw new PrintFailure("Invalid print job.");
  const input = parsed.data;
  const isPdf = "format" in input && input.format === "pdf";
  let bytes: Uint8Array;
  let pageWidth: number | null = null, pageHeight: number | null = null;
  let count: number;
  try {
    if ("document" in input) {
      const pages = layoutLabelPages(input.document.labels, input.document.media);
      pageWidth = pages[0].width; pageHeight = pages[0].height;
      if (pages.some(page => page.width !== pageWidth || page.height !== pageHeight))
        throw new Error("Remote jobs must use one paper size. Use a sheet layout or separate jobs.");
      bytes = await createLabelPdf(input.document);
      count = input.document.labels.length;
    } else {
      bytes = validateSharedRasters(input.labels.map(s => {
        const data = Buffer.from(s, "base64");
        if (data.toString("base64") !== s) throw new Error("Invalid base64");
        return data;
      }), input.tape);
      count = input.labels.length;
    }
    if (bytes.length > 24 * 1024 * 1024) throw new Error("Print document is too large.");
  } catch (error) {
    throw new PrintFailure(error instanceof Error ? error.message : "Invalid print document.", 422);
  }
  const payload = Buffer.from(bytes).toString("base64"), hash = printHash(bytes);
  const format = isPdf ? "pdf" : "ptouch";
  return db.transaction(async (tx) => {
    // The printer row serializes enqueue limits and dispatch for this device.
    const [printer] = await tx.execute(
      sql`SELECT * FROM label_printers WHERE id=${input.printerId} AND organization_id=${identity.organizationId} AND enabled=true FOR UPDATE`,
    );
    if (!printer) throw new PrintFailure("Printer not found.", 404);
    if ((printer.kind ?? "ptouch") !== (isPdf ? "system" : "ptouch"))
      throw new PrintFailure("Print format does not match this printer.", 409);
    if (isPdf && (pageWidth! > Number(printer.max_width_mm) || pageHeight! > Number(printer.max_height_mm)))
      throw new PrintFailure("The document exceeds this printer's paper size.", 409);
    if ("tape" in input && Number(printer.tape_width) !== input.tape)
      throw new PrintFailure(
        "The label tape width does not match the shared printer.",
        409,
      );
    const [existing] = await tx.execute(
      sql`SELECT * FROM label_print_jobs WHERE id=${input.id}`,
    );
    if (existing) {
      if (
        existing.organization_id !== identity.organizationId ||
        existing.created_by !== identity.subject ||
        existing.printer_id !== input.printerId ||
        existing.payload_hash !== hash
      )
        throw new PrintFailure("Print request ID already used.", 409);
      return jobDto(existing);
    }
    await tx.execute(
      sql`UPDATE label_print_jobs SET status='expired',payload=NULL,finished_at=now() WHERE printer_id=${input.printerId} AND status='queued' AND expires_at<now()`,
    );
    const [limits] = await tx.execute(
      sql`SELECT count(*) FILTER (WHERE status IN ('queued','claimed'))::int AS pending, count(*) FILTER (WHERE created_by=${identity.subject} AND created_at>now()-interval '1 minute')::int AS recent FROM label_print_jobs WHERE printer_id=${input.printerId}`,
    );
    if (Number(limits.pending) >= 20 || Number(limits.recent) >= 10)
      throw new PrintFailure(
        "Print queue is busy. Please wait before submitting more labels.",
        429,
      );
    const [row] = await tx.execute(
      sql`INSERT INTO label_print_jobs(id,organization_id,printer_id,created_by,label_count,payload,payload_hash,format,page_width_mm,page_height_mm) VALUES(${input.id},${identity.organizationId},${input.printerId},${identity.subject},${count},${payload},${hash},${format},${pageWidth},${pageHeight}) RETURNING *`,
    );
    return jobDto(row);
  });
}
export async function agentPrinter(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (iprt_[A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) throw new PrintFailure("Unauthorized", 401);
  const [printer] = await db.execute(
    sql`SELECT p.* FROM label_printers p JOIN organizations o ON o.id=p.organization_id WHERE p.token_hash=${printHash(token)} AND p.enabled=true AND o.is_read_only=false`,
  );
  if (!printer) throw new PrintFailure("Unauthorized", 401);
  return printer;
}
export async function claimSharedPrint(printerId: string, claimId: string) {
  return db.transaction(async (tx) => {
    const [printer] = await tx.execute(
      sql`UPDATE label_printers SET last_seen_at=now() WHERE id=${printerId} AND enabled=true RETURNING id`,
    );
    if (!printer) throw new PrintFailure("Printer disabled.", 403);
    await tx.execute(
      sql`UPDATE label_print_jobs SET status='expired',payload=NULL,finished_at=now() WHERE printer_id=${printerId} AND status='queued' AND expires_at<now()`,
    );
    // Never reissue a job after dispatch. A crash may have happened after printing.
    await tx.execute(
      sql`UPDATE label_print_jobs SET status='uncertain',payload=NULL,finished_at=now() WHERE printer_id=${printerId} AND status='claimed' AND claimed_at<now()-interval '5 minutes'`,
    );
    await tx.execute(
      sql`DELETE FROM label_print_jobs WHERE printer_id=${printerId} AND created_at<now()-interval '7 days' AND status NOT IN ('queued','claimed')`,
    );
    const [existing] = await tx.execute(
      sql`SELECT * FROM label_print_jobs WHERE printer_id=${printerId} AND claim_id=${claimId}`,
    );
    if (existing)
      return existing.status === "claimed"
        ? {
            id: existing.id,
            data: existing.payload,
            sha256: existing.payload_hash,
            format: existing.format, pageWidthMm: existing.page_width_mm, pageHeightMm: existing.page_height_mm,
          }
        : null;
    const [active] = await tx.execute(
      sql`SELECT id FROM label_print_jobs WHERE printer_id=${printerId} AND status='claimed' LIMIT 1`,
    );
    if (active) return null;
    const [next] = await tx.execute(
      sql`SELECT id FROM label_print_jobs WHERE printer_id=${printerId} AND status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE`,
    );
    if (!next) return null;
    const [job] = await tx.execute(
      sql`UPDATE label_print_jobs SET status='claimed',claim_id=${claimId},claimed_at=now() WHERE id=${next.id} RETURNING *`,
    );
    return { id: job.id, data: job.payload, sha256: job.payload_hash, format: job.format, pageWidthMm: job.page_width_mm, pageHeightMm: job.page_height_mm };
  });
}
