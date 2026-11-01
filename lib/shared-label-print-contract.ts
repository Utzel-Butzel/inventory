import { z } from "zod";
import { labelDocumentSchema, LABEL_DOCUMENT_LIMIT } from "@/lib/label-document";
import {
  combinePtouchLabels,
  encodePtouchRaster,
  PTOUCH_MAX_JOB_BYTES,
  PTOUCH_TAPES,
  type PtouchTape,
} from "@/lib/ptouch-raster";

export const SHARED_PRINT_BODY_LIMIT =
  LABEL_DOCUMENT_LIMIT;
const ptouchPrintSchema = z
  .object({
    id: z.uuid(),
    printerId: z.uuid(),
    tape: z.number().refine((n) => PTOUCH_TAPES.includes(n as PtouchTape)),
    labels: z
      .array(
        z
          .string()
          .min(1)
          .max(Math.ceil((PTOUCH_MAX_JOB_BYTES * 4) / 3))
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const sharedPrintSchema = z.union([
  ptouchPrintSchema,
  z.object({ id: z.uuid(), printerId: z.uuid(), format: z.literal("pdf"), document: labelDocumentSchema }).strict(),
]);
export const printerCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["ptouch", "system"]).default("ptouch"),
  location: z.string().trim().max(120).default(""),
  tape: z.number().refine(n => PTOUCH_TAPES.includes(n as PtouchTape)).default(24),
  maxWidthMm: z.number().finite().positive().max(1000).default(1000),
  maxHeightMm: z.number().finite().positive().max(1000).default(1000),
}).strict();
export type SharedPrinter = {
  id: string;
  name: string;
  kind: "ptouch" | "system";
  location: string;
  maxWidthMm: number;
  maxHeightMm: number;
  tape: PtouchTape;
  online: boolean;
  enabled: boolean;
};
export type SharedPrintJob = {
  id: string;
  printerId: string;
  count: number;
  status: string;
  createdAt: string;
  spoolJobId: number | null;
};

/** Only our fixed raster grammar is accepted. No embedded printer commands,
 * paths, URLs, shell commands, or destinations may come from a client. */
export function validateSharedRasters(
  labels: Uint8Array[],
  tape: number,
): Uint8Array {
  if (!PTOUCH_TAPES.includes(tape as PtouchTape))
    throw new Error("Invalid tape width.");
  let size = 0;
  for (const label of labels) {
    size += label.length;
    if (size > PTOUCH_MAX_JOB_BYTES + 102 * 99)
      throw new Error("PTOUCH_BATCH_SIZE");
    const width =
      label[113] | (label[114] << 8) | (label[115] << 16) | (label[116] << 24);
    if (width < 4 || width > 14116 || label.length !== 135 + width * 20)
      throw new Error("Invalid raster length.");
    const header = encodePtouchRaster(
      { width: 4, height: 1, data: new Uint8ClampedArray(16) },
      tape as PtouchTape,
    ).slice(0, 134);
    header[113] = width & 255;
    header[114] = width >>> 8;
    if (!header.every((b, i) => label[i] === b) || label.at(-1) !== 0x1a)
      throw new Error("Invalid raster header.");
    for (let offset = 134; offset < label.length - 1; offset += 20) {
      if (
        label[offset] !== 0x47 ||
        label[offset + 1] !== 17 ||
        label[offset + 2] !== 0 ||
        label[offset + 3] !== 15
      )
        throw new Error("Invalid raster line.");
    }
  }
  return combinePtouchLabels(labels);
}

export class PrintBodyError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function boundedPrintJson(
  request: Request,
  limit = SHARED_PRINT_BODY_LIMIT,
): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > limit)
    throw new PrintBodyError("Request too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new PrintBodyError("Missing request body.");
  let length = 0;
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new PrintBodyError("Request too large.", 413);
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new PrintBodyError("Invalid JSON request.");
  }
}
