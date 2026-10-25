import { z } from "zod";
import { PTOUCH_MAX_JOB_BYTES } from "@/lib/ptouch-raster";

export const QZ_MAX_REQUEST_BYTES = Math.ceil(PTOUCH_MAX_JOB_BYTES / 3) * 4 + 100_000;

const printRequest = z.object({
  call: z.literal("print"),
  timestamp: z.number().int(),
  params: z.object({
    printer: z.object({ name: z.string().max(200).regex(/P[ _-]?710BT/i) }).strict(),
    options: z.object({ forceRaw: z.literal(true), copies: z.literal(1) }).passthrough(),
    data: z.array(z.object({
      type: z.literal("raw"), format: z.literal("command"), flavor: z.literal("base64"),
      data: z.string().min(1).max(Math.ceil(PTOUCH_MAX_JOB_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/),
    }).strict()).length(1),
  }).strict(),
}).strict();

const discoveryRequest = z.object({
  call: z.literal("printers.find"), timestamp: z.number().int(),
  params: z.object({ query: z.string().max(200).nullable().optional() }).strict(),
}).strict();

export function isAllowedQzRequest(request: string, now = Date.now()): boolean {
  if (request.length > QZ_MAX_REQUEST_BYTES) return false;
  try {
    const result = z.union([printRequest, discoveryRequest]).safeParse(JSON.parse(request));
    return result.success && Math.abs(now - result.data.timestamp) < 60_000;
  } catch {
    return false;
  }
}
