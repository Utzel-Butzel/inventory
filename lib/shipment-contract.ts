import { z } from "zod";

import { shipmentStatuses, type ShipmentStatus } from "@/db/schema";

export const shipmentStatusSchema = z.enum(shipmentStatuses);

export const supportedShipmentCarriers = [
  "dhl",
  "dpd",
  "ups",
  "gls",
  "hermes",
  "other",
] as const;

export const shipmentCarrierCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);

const optionalText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable().optional();

const optionalHttpsUrl = z
  .string()
  .trim()
  .url()
  .max(2_048)
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Tracking URLs must use HTTPS.",
  })
  .nullable()
  .optional();

export const shipmentLineInputSchema = z
  .object({
    orderLineId: z.string().uuid(),
    quantity: z.number().int().min(1).max(2_000_000_000),
    unitIds: z.array(z.string().uuid()).max(100).optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.unitIds || new Set(value.unitIds).size === value.unitIds.length,
    {
      path: ["unitIds"],
      message: "Each serialized unit may appear only once on a shipment line.",
    },
  );

export const shipmentCreateSchema = z
  .object({
    carrierCode: shipmentCarrierCodeSchema,
    service: optionalText(120),
    trackingNumber: optionalText(180),
    trackingUrl: optionalHttpsUrl,
    status: z.enum(["draft", "ready"]).default("draft"),
    note: z.string().trim().max(20_000).optional(),
    lines: z.array(shipmentLineInputSchema).min(1).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.lines.map((line) => line.orderLineId)).size !==
      value.lines.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Each order line may appear only once in a shipment.",
      });
    }
    const unitIds = value.lines.flatMap((line) => line.unitIds ?? []);
    if (new Set(unitIds).size !== unitIds.length) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Each serialized unit may appear only once in a shipment.",
      });
    }
    if (value.status === "ready" && !value.trackingNumber) {
      context.addIssue({
        code: "custom",
        path: ["trackingNumber"],
        message: "A ready shipment requires a tracking number.",
      });
    }
  });

export const shipmentPatchSchema = z
  .object({
    carrierCode: shipmentCarrierCodeSchema.optional(),
    service: optionalText(120),
    trackingNumber: optionalText(180),
    trackingUrl: optionalHttpsUrl,
    status: shipmentStatusSchema.optional(),
    occurredAt: z.string().datetime().optional(),
    note: z.string().trim().max(20_000).optional(),
    eventNote: z.string().trim().max(2_000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one shipment change.",
  })
  .refine((value) => value.occurredAt === undefined || value.status !== undefined, {
    path: ["occurredAt"],
    message: "An effective timestamp requires a status change.",
  });

const shipmentTransitions: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  draft: ["ready", "cancelled"],
  ready: ["draft", "shipped", "cancelled"],
  shipped: ["in_transit", "delivered", "exception", "returned"],
  in_transit: ["delivered", "exception", "returned"],
  delivered: ["returned"],
  exception: ["in_transit", "delivered", "returned"],
  returned: [],
  cancelled: [],
};

export function canTransitionShipment(
  current: ShipmentStatus,
  next: ShipmentStatus,
) {
  return current === next || shipmentTransitions[current].includes(next);
}

export function defaultTrackingUrl(
  carrierCode: string,
  trackingNumber: string | null | undefined,
) {
  const number = trackingNumber?.trim();
  if (!number) return null;
  const encoded = encodeURIComponent(number);
  switch (carrierCode) {
    case "dhl":
      return `https://www.dhl.de/de/privatkunden/dhl-sendungsverfolgung.html?piececode=${encoded}`;
    case "dpd":
      return `https://tracking.dpd.de/status/de_DE/parcel/${encoded}`;
    case "ups":
      return `https://www.ups.com/track?loc=de_DE&tracknum=${encoded}`;
    case "gls":
      return `https://gls-group.com/app/service/openparceltracking?match=${encoded}`;
    case "hermes":
      return `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation/#${encoded}`;
    default:
      return null;
  }
}

export type ShipmentCreateRequest = z.infer<typeof shipmentCreateSchema>;
export type ShipmentPatchRequest = z.infer<typeof shipmentPatchSchema>;
