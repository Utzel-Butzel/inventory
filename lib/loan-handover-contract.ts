import { z } from "zod";

export const HANDOVER_MAX_PHOTOS = 4;
export const HANDOVER_MAX_PHOTO_CHARACTERS = 1_400_000;
export const HANDOVER_MAX_BODY_BYTES = 6_000_000;
export const handoverConditions = ["good", "worn", "damaged"] as const;

export const loanHandoverSchema = z.object({
  condition: z.enum(handoverConditions),
  notes: z.string().trim().max(4000).default(""),
  accessories: z.array(z.object({
    name: z.string().trim().min(1).max(160),
    present: z.boolean(),
  }).strict()).max(30).default([]),
  photos: z.array(z.string().max(HANDOVER_MAX_PHOTO_CHARACTERS)
    .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/)).max(HANDOVER_MAX_PHOTOS).default([]),
  givenBy: z.string().trim().min(1).max(240),
  receivedBy: z.string().trim().min(1).max(240),
  confirmed: z.literal(true),
}).strict().superRefine((value, ctx) => {
  const names = value.accessories.map((item) => item.name.toLocaleLowerCase("en"));
  if (new Set(names).size !== names.length) {
    ctx.addIssue({ code: "custom", path: ["accessories"], message: "Accessory names must be unique." });
  }
  if ((value.condition === "damaged" || value.accessories.some((item) => !item.present)) && !value.notes) {
    ctx.addIssue({ code: "custom", path: ["notes"], message: "Describe damage or missing accessories." });
  }
});

export type LoanHandoverInput = z.infer<typeof loanHandoverSchema>;
export type LoanHandoverDocument = LoanHandoverInput & {
  version: 1;
  phase: "checkout" | "return";
  assignmentId: string | null;
  orderId?: string;
  orderLineId?: string;
  movementId?: string;
  resourceId: string;
  resourceName: string;
  unitCode: string | null;
  quantity: number;
  borrower: string;
  dueAt: string | null;
  occurredAt: string;
  recordedAt: string;
  recordedBy: string;
};

export function validateHandoverTransition(input: {
  phase: "checkout" | "return" | "cancel";
  kind: string;
  documentedCheckout: boolean;
  handover?: LoanHandoverInput;
  originalAccessories?: Array<{ name: string; present: boolean }>;
}) {
  if (input.phase === "cancel" && (input.documentedCheckout || input.handover)) {
    return "A documented handover must be returned with a return report, not cancelled.";
  }
  if (input.handover && input.kind !== "checkout") {
    return "Handover reports are only supported for equipment loans.";
  }
  if (input.phase === "return" && input.documentedCheckout && !input.handover) {
    return "A return report is required for this documented loan.";
  }
  if (input.phase === "return" && input.handover) {
    const names = new Set(input.handover.accessories.map((item) => item.name.toLocaleLowerCase("en")));
    if (input.originalAccessories?.some((item) => !names.has(item.name.toLocaleLowerCase("en")))) {
      return "Check every accessory from the checkout report before returning the loan.";
    }
  }
  return null;
}

export class HandoverBodyError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function readHandoverRequest(request: Request) {
  if (Number(request.headers.get("content-length")) > HANDOVER_MAX_BODY_BYTES) {
    throw new HandoverBodyError("Handover photos exceed the upload limit.", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HandoverBodyError("Expected a JSON request body.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > HANDOVER_MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HandoverBodyError("Handover photos exceed the upload limit.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(body)) as unknown; }
  catch { throw new HandoverBodyError("Expected a JSON request body.", 400); }
}
