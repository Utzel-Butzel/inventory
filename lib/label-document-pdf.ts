import PDFDocument from "pdfkit";
import sharp from "sharp";
import { labelDocumentSchema, layoutLabelPages, type LabelDocument, type LabelSnapshot } from "@/lib/label-document";

/** Decode and normalize pixels; uploaded PDFs, URLs and printer commands are never accepted. */
export async function snapshotPng(snapshot: LabelSnapshot): Promise<Buffer> {
  const bytes = Buffer.from(snapshot.png.slice("data:image/png;base64,".length), "base64");
  const image = sharp(bytes, { limitInputPixels: 16_000_000 });
  const info = await image.metadata();
  if (info.format !== "png" || !info.width || !info.height || (info.pages ?? 1) !== 1) throw new Error("Invalid label image.");
  const ratio = (info.width / info.height) / (snapshot.widthMm / snapshot.heightMm);
  if (Math.abs(ratio - 1) > 0.03) throw new Error("Label image dimensions do not match.");
  return image.flatten({ background: "white" }).png().toBuffer();
}
export async function createLabelPdf(input: LabelDocument): Promise<Buffer> {
  const document = labelDocumentSchema.parse(input);
  const pages = layoutLabelPages(document.labels, document.media);
  const images: Buffer[] = [];
  const cached = new Map<string, Buffer>();
  // Sequential decoding bounds peak memory for a full label batch.
  let totalPixels = 0;
  for (const label of document.labels) {
    const metadata = await sharp(Buffer.from(label.png.slice("data:image/png;base64,".length), "base64"), { limitInputPixels: 16_000_000 }).metadata();
    totalPixels += (metadata.width ?? 0) * (metadata.height ?? 0);
    if (totalPixels > 64_000_000) throw new Error("The print document contains too many image pixels. Split it into smaller jobs.");
    let png = cached.get(JSON.stringify(label));
    if (!png) { png = await snapshotPng(label); cached.set(JSON.stringify(label), png); }
    images.push(png);
  }
  const pdf = new PDFDocument({ autoFirstPage: false, margin: 0, info: {
    Title: "Inventory labels", Creator: "Inventory", CreationDate: new Date(0), ModDate: new Date(0),
  } });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    pdf.on("data", chunk => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });
  const pt = (mm: number) => mm * 72 / 25.4;
  for (const page of pages) {
    pdf.addPage({ size: [pt(page.width), pt(page.height)], margin: 0 });
    for (const label of page.labels) pdf.image(images[label.index], pt(label.x), pt(label.y), { width: pt(label.width), height: pt(label.height) });
  }
  pdf.end();
  return result;
}
