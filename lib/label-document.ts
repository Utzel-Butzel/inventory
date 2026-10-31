import { z } from "zod";

const mm = z.number().finite().positive().max(1000);
const offset = z.number().finite().min(-50).max(50);
export const labelSnapshotSchema = z.object({
  png: z.string().max(3_000_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
  widthMm: mm,
  heightMm: mm,
  inverted: z.boolean().optional(),
  expectedQr: z.string().max(8192).optional(),
  regions: z.array(z.object({
    type: z.enum(["qr", "photo"]), x: z.number().min(0).max(1), y: z.number().min(0).max(1),
    width: z.number().positive().max(1), height: z.number().positive().max(1),
    optimization: z.enum(["auto", "standard"]).optional(),
  }).strict()).max(32).optional(),
}).strict();
export type LabelSnapshot = z.infer<typeof labelSnapshotSchema>;

export const printMediaSchema = z.object({
  mode: z.enum(["individual", "sheet"]),
  pageWidthMm: mm,
  pageHeightMm: mm,
  columns: z.number().int().min(1).max(30),
  rows: z.number().int().min(1).max(100),
  cellWidthMm: mm,
  cellHeightMm: mm,
  marginLeftMm: z.number().finite().min(0).max(500),
  marginTopMm: z.number().finite().min(0).max(500),
  gapXMm: z.number().finite().min(0).max(100),
  gapYMm: z.number().finite().min(0).max(100),
  startPosition: z.number().int().min(1).max(3000),
  offsetXMm: offset,
  offsetYMm: offset,
}).strict().superRefine((m, ctx) => {
  if (m.mode !== "sheet") return;
  if (m.startPosition > m.columns * m.rows) ctx.addIssue({ code: "custom", message: "PRINT_START_POSITION" });
  const right = m.marginLeftMm + m.columns * m.cellWidthMm + (m.columns - 1) * m.gapXMm;
  const bottom = m.marginTopMm + m.rows * m.cellHeightMm + (m.rows - 1) * m.gapYMm;
  if (m.marginLeftMm + m.offsetXMm < 0 || m.marginTopMm + m.offsetYMm < 0 || right + m.offsetXMm > m.pageWidthMm + 0.001 || bottom + m.offsetYMm > m.pageHeightMm + 0.001)
    ctx.addIssue({ code: "custom", message: "PRINT_GRID_OVERFLOW" });
});
export type PrintMedia = z.infer<typeof printMediaSchema>;
export const DEFAULT_PRINT_MEDIA: PrintMedia = {
  mode: "individual", pageWidthMm: 210, pageHeightMm: 297, columns: 3, rows: 8,
  cellWidthMm: 63.5, cellHeightMm: 33.9, marginLeftMm: 7.75, marginTopMm: 12.9,
  gapXMm: 2.5, gapYMm: 0, startPosition: 1, offsetXMm: 0, offsetYMm: 0,
};
export const labelDocumentSchema = z.object({
  labels: z.array(labelSnapshotSchema).min(1).max(100), media: printMediaSchema,
}).strict();
export const LABEL_DOCUMENT_LIMIT = 24 * 1024 * 1024;
export type LabelDocument = z.infer<typeof labelDocumentSchema>;
export type PrintPlacement = { index: number; x: number; y: number; width: number; height: number };
export type PrintPage = { width: number; height: number; labels: PrintPlacement[] };

/** One layout calculation for preview, browser printing and PDF; never scale a label. */
export function layoutLabelPages(labels: Pick<LabelSnapshot, "widthMm" | "heightMm">[], input: PrintMedia): PrintPage[] {
  const media = printMediaSchema.parse(input);
  if (!labels.length || labels.length > 100) throw new Error("PRINT_COUNT");
  const pages: PrintPage[] = [];
  labels.forEach((label, index) => {
    mm.parse(label.widthMm); mm.parse(label.heightMm);
    if (media.mode === "individual") {
      if (media.offsetXMm || media.offsetYMm) throw new Error("PRINT_INDIVIDUAL_OFFSET");
      pages.push({ width: label.widthMm, height: label.heightMm, labels: [{ index, x: 0, y: 0, width: label.widthMm, height: label.heightMm }] });
      return;
    }
    if (label.widthMm > media.cellWidthMm + 0.001 || label.heightMm > media.cellHeightMm + 0.001) throw new Error("PRINT_LABEL_TOO_LARGE");
    const slot = index + media.startPosition - 1;
    const pageIndex = Math.floor(slot / (media.columns * media.rows));
    const onPage = slot % (media.columns * media.rows);
    const page = pages[pageIndex] ??= { width: media.pageWidthMm, height: media.pageHeightMm, labels: [] };
    page.labels.push({ index,
      x: media.marginLeftMm + media.offsetXMm + (onPage % media.columns) * (media.cellWidthMm + media.gapXMm),
      y: media.marginTopMm + media.offsetYMm + Math.floor(onPage / media.columns) * (media.cellHeightMm + media.gapYMm),
      width: label.widthMm, height: label.heightMm });
  });
  return pages;
}
