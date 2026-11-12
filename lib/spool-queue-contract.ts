import { z } from "zod";
export const spoolJobSchema = z.object({
  ref: z.string().regex(/^[a-f0-9]{64}$/), id: z.number().int().positive(),
  title: z.string().max(240), owner: z.string().max(120), state: z.string().max(80),
}).strict();
export const spoolSnapshotSchema = z.object({
  actions: z.array(z.enum(["cancel", "pause", "resume", "restart", "repair"])).optional(),
  supported: z.boolean(), jobs: z.array(spoolJobSchema).max(200),
}).strict();
export const spoolReceiptSchema = z.object({ id: z.uuid(), result: z.enum(["done", "uncertain"]) }).strict();
export type SpoolJob = z.infer<typeof spoolJobSchema>;
export type SpoolSnapshot = z.infer<typeof spoolSnapshotSchema>;

export const spoolOperationSchema = z.object({
  printerId: z.uuid(), action: z.enum(["cancel", "pause", "resume", "restart", "repair"]).default("cancel"),
  refs: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(200),
}).strict().refine(input => input.action === "repair" ? input.refs.length === 0 : input.refs.length > 0);
