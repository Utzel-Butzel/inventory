import { z } from "zod";

export const DEFAULT_LOAN_DURATION_DAYS = 7;
export const DEFAULT_MAX_LOAN_DURATION_DAYS = 30;

export const lendingSettingsSchema = z
  .object({
    enabled: z.boolean(),
    approvalRequired: z.boolean(),
    defaultDurationDays: z.number().int().min(1).max(3650),
    maxDurationDays: z.number().int().min(1).max(3650),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.defaultDurationDays > value.maxDurationDays) {
      context.addIssue({
        code: "custom",
        path: ["defaultDurationDays"],
        message: "The default duration cannot exceed the maximum duration.",
      });
    }
  });

export type LendingSettingsInput = z.infer<typeof lendingSettingsSchema>;

export function loanWindowDurationDays(startsAt: Date, dueAt: Date) {
  return (dueAt.getTime() - startsAt.getTime()) / 86_400_000;
}

export function isLoanOverdue(input: {
  kind: string;
  status: string;
  dueAt: Date | string | null;
}, now = new Date()) {
  if (input.kind !== "checkout" || input.status !== "active" || !input.dueAt) {
    return false;
  }
  const dueAt = input.dueAt instanceof Date ? input.dueAt : new Date(input.dueAt);
  return !Number.isNaN(dueAt.getTime()) && dueAt < now;
}
