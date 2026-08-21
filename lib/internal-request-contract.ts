import { z } from "zod";

export const MAX_INTERNAL_REQUEST_LINES = 50;
export const MAX_INTERNAL_REQUEST_WINDOW_DAYS = 366;

export const internalRequestCreateSchema = z
  .object({
    deliveryResourceId: z.string().uuid().nullable().optional(),
    startsAt: z.string().datetime(),
    dueAt: z.string().datetime(),
    note: z.string().trim().max(20_000).optional(),
    lines: z
      .array(
        z
          .object({
            resourceId: z.string().uuid(),
            quantity: z.number().int().min(1).max(2_000_000_000),
            note: z.string().trim().max(20_000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_INTERNAL_REQUEST_LINES),
  })
  .strict()
  .superRefine((value, context) => {
    const startsAt = new Date(value.startsAt);
    const dueAt = new Date(value.dueAt);
    if (dueAt <= startsAt) {
      context.addIssue({
        code: "custom",
        path: ["dueAt"],
        message: "The return date must be after the start date.",
      });
    }
    if (
      dueAt.getTime() - startsAt.getTime() >
      MAX_INTERNAL_REQUEST_WINDOW_DAYS * 86_400_000
    ) {
      context.addIssue({
        code: "custom",
        path: ["dueAt"],
        message: `A request may cover at most ${MAX_INTERNAL_REQUEST_WINDOW_DAYS} days.`,
      });
    }
    const resourceIds = value.lines.map((line) => line.resourceId);
    if (new Set(resourceIds).size !== resourceIds.length) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Each inventory item may appear only once.",
      });
    }
  });

export const internalRequestActionSchema = z
  .object({
    action: z.enum(["approve", "reject", "cancel", "fulfill"]),
    note: z.string().trim().max(20_000).optional(),
  })
  .strict();

export const internalRequestStatusFilterSchema = z.enum([
  "submitted",
  "approved",
  "rejected",
  "fulfilled",
  "cancelled",
]);

export type ReservationWindow = {
  startsAt: Date;
  dueAt: Date | null;
};

export function reservationWindowsOverlap(
  left: ReservationWindow,
  right: ReservationWindow,
) {
  return (
    (right.dueAt === null || left.startsAt < right.dueAt) &&
    (left.dueAt === null || right.startsAt < left.dueAt)
  );
}

export type InternalRequestLifecycleStatus = z.infer<
  typeof internalRequestStatusFilterSchema
>;
export type InternalRequestAction = z.infer<
  typeof internalRequestActionSchema
>["action"];

const transitions: Record<
  InternalRequestLifecycleStatus,
  readonly InternalRequestAction[]
> = {
  submitted: ["approve", "reject", "cancel"],
  approved: ["fulfill", "cancel"],
  rejected: [],
  fulfilled: [],
  cancelled: [],
};

export function canTransitionInternalRequest(
  status: InternalRequestLifecycleStatus,
  action: InternalRequestAction,
) {
  return transitions[status].includes(action);
}

export function internalRequestStatusAfter(
  status: InternalRequestLifecycleStatus,
  action: InternalRequestAction,
): InternalRequestLifecycleStatus | null {
  if (!canTransitionInternalRequest(status, action)) return null;
  if (action === "approve") return "approved";
  if (action === "reject") return "rejected";
  if (action === "fulfill") return "fulfilled";
  return "cancelled";
}
