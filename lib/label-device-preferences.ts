import { z } from "zod";
export const devicePrintPreferencesSchema = z.object({
  printTarget: z.enum(["browser", "ptouch", "shared"]),
  printer: z.string().max(320),
  sharedPrinter: z.union([z.uuid(), z.literal("")]),
  tape: z.union([z.literal(3.5), z.literal(6), z.literal(9), z.literal(12), z.literal(18), z.literal(24)]),
}).strict();
export function devicePrintPreferenceKey(scope: string) {
  return `inventory.labelDestination.v2:${scope}`;
}
