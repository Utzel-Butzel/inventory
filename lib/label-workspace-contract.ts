import { z } from "zod";
import { labelSnapshotSchema, printMediaSchema } from "@/lib/label-document";
import { labelSetupCreateSchema } from "@/lib/label-setup-contract";
import { PTOUCH_TAPES, type PtouchTape } from "@/lib/ptouch-raster";

const tapeSchema = z.number().refine((n): n is PtouchTape => PTOUCH_TAPES.includes(n as PtouchTape));
const text = z.string().max(10000);
const resourceSchema = z.object({
  id: z.uuid(), name: text, subtitle: text.optional(), sku: text.nullable(),
  barcode: text.nullable(), location: text.nullable(), type: z.string().max(64), quantity: z.number(),
  cover: z.object({ url: z.string().max(8192), altText: text }).nullable(),
  stockUnit: z.object({ id: z.uuid(), code: text, location: text.nullable() }).optional(),
});
export const savedLabelSchema = z.object({
  id: z.uuid(), name: text, template: text, tape: tapeSchema, widthMm: z.number().positive().max(1000),
  data: z.string().max(400000).regex(/^[A-Za-z0-9+/]*={0,2}$/),
  snapshot: labelSnapshotSchema.optional(),
  preview: z.string().max(3_000_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
  resource: resourceSchema, original: resourceSchema,
  setup: labelSetupCreateSchema.safeExtend({ id: z.string().max(100), revision: z.number().int().positive(), createdAt: text, updatedAt: text }),
});
export const labelPreferencesSchema = z.object({
  media: printMediaSchema.optional(),
  setupId: z.string().max(100), printTarget: z.enum(["browser", "ptouch", "shared"]),
  tape: tapeSchema, printer: z.string().max(320), sharedPrinter: z.union([z.uuid(), z.literal("")]),
}).partial().strict();
export const labelWorkspaceMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preferences"), preferences: labelPreferencesSchema }).strict(),
  z.object({ action: z.literal("queue"), revision: z.number().int().nonnegative(), labels: z.array(savedLabelSchema).max(100).refine(labels => new Set(labels.map(label => label.id)).size === labels.length, "Duplicate label IDs") }).strict(),
]);
export type SavedLabel = z.infer<typeof savedLabelSchema>;
export type LabelPreferences = z.infer<typeof labelPreferencesSchema>;
export type LabelWorkspaceMutation = z.infer<typeof labelWorkspaceMutationSchema>;
export type LabelWorkspace = { revision: number; labels: SavedLabel[]; preferences: LabelPreferences };
export const LABEL_WORKSPACE_LIMIT = 24 * 1024 * 1024;
