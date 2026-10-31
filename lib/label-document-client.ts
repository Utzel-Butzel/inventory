import { readyLabelDimensions } from "@/lib/label-print-dimensions";
import { waitForLabelImageCrops } from "@/lib/label-image-crop";
import { labelFontEmbedCss } from "@/lib/label-fonts";
import { labelSnapshotSchema, layoutLabelPages, type LabelSnapshot, type PrintMedia } from "@/lib/label-document";
import type { PreparedLabel } from "@/lib/label-workspace-client";
import type { PtouchTape } from "@/lib/ptouch-raster";

export async function captureLabel(node: HTMLElement, widthMm: number, heightMm: number, expectedQr?: string): Promise<LabelSnapshot> {
  await waitForLabelImageCrops(node);
  await Promise.all(Array.from(node.querySelectorAll("img"), image => image.decode()));
  ({ widthMm, heightMm } = await readyLabelDimensions(node, widthMm, heightMm));
  const width = Math.round(widthMm * 300 / 25.4), height = Math.round(heightMm * 300 / 25.4);
  if (width * height > 16_000_000) throw new Error("PRINT_IMAGE_TOO_LARGE");
  const fontEmbedCSS = await labelFontEmbedCss(node);
  const { toCanvas } = await import("html-to-image");
  const canvas = await toCanvas(node, { canvasWidth: width, canvasHeight: height, pixelRatio: 1,
    backgroundColor: node.dataset.labelInverted === "true" ? "black" : "white", skipFonts: !fontEmbedCSS, fontEmbedCSS,
    style: { boxShadow: "none", margin: "0" } });
  const bounds = node.getBoundingClientRect();
  const regions = Array.from(node.querySelectorAll<HTMLElement>("[data-label-qr],.printable-label-image"), element => {
    const box = element.getBoundingClientRect();
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    return { type: element.hasAttribute("data-label-qr") ? "qr" as const : "photo" as const,
      x: clamp((box.left - bounds.left) / bounds.width), y: clamp((box.top - bounds.top) / bounds.height),
      width: clamp(box.width / bounds.width), height: clamp(box.height / bounds.height),
      optimization: element.dataset.labelPhotoOptimization === "standard" ? "standard" as const : "auto" as const };
  });
  return labelSnapshotSchema.parse({ png: canvas.toDataURL("image/png"), widthMm, heightMm, regions, expectedQr, inverted: node.dataset.labelInverted === "true" });
}

export function preparedSnapshot(label: PreparedLabel): LabelSnapshot {
  // Old workspaces contain a frozen monochrome preview with physical tape edges.
  return label.snapshot ?? { png: label.preview, widthMm: label.widthMm, heightMm: label.tape };
}

export async function ptouchSnapshot(label: PreparedLabel, tape: PtouchTape): Promise<Uint8Array> {
  if (label.data.length && label.tape === tape) return label.data;
  const snapshot = preparedSnapshot(label);
  const host = document.createElement("div");
  Object.assign(host.style, { position: "fixed", left: "-20000px", top: "0" });
  const node = document.createElement("div");
  Object.assign(node.style, { position: "relative", width: `${snapshot.widthMm}mm`, height: `${snapshot.heightMm}mm` });
  host.append(node);
  node.dataset.labelInverted = String(snapshot.inverted ?? false);
  const img = document.createElement("img");
  img.src = snapshot.png;
  Object.assign(img.style, { width: "100%", height: "100%", display: "block" });
  node.append(img);
  for (const region of snapshot.regions ?? []) {
    const marker = document.createElement("div");
    Object.assign(marker.style, { position: "absolute", left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` });
    if (region.type === "qr") marker.dataset.labelQr = "true";
    else { marker.className = "printable-label-image"; marker.dataset.labelPhotoOptimization = region.optimization ?? "auto"; }
    node.append(marker);
  }
  document.body.append(host);
  try {
    await img.decode();
    const { renderPtouchLabel } = await import("@/lib/qz-label-printer");
    return (await renderPtouchLabel(node, snapshot.widthMm, snapshot.heightMm, tape, snapshot.expectedQr)).data;
  } finally { host.remove(); }
}

/** Isolated, self-contained print document. Browser cancellation never consumes the queue. */
export async function printLabelDocument(labels: LabelSnapshot[], media: PrintMedia) {
  const pages = layoutLabelPages(labels, media);
  const frame = document.createElement("iframe");
  frame.title = "Inventory print document";
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", left: "-20000px", top: "0", width: "1200px", height: "800px", border: "0" });
  document.body.append(frame);
  try {
    const doc = frame.contentDocument!, win = frame.contentWindow!;
    const style = doc.createElement("style");
    style.textContent = `@page{size:${pages[0].width}mm ${pages[0].height}mm;margin:0}html,body{margin:0;padding:0;background:white}section{position:relative;break-after:page;overflow:hidden}section:last-child{break-after:auto}img{position:absolute;display:block}*{print-color-adjust:exact;-webkit-print-color-adjust:exact}`;
    pages.forEach((page, index) => {
      style.textContent += `@page inventory${index}{size:${page.width}mm ${page.height}mm;margin:0}`;
      const section = doc.createElement("section");
      Object.assign(section.style, { page: `inventory${index}`, width: `${page.width}mm`, height: `${page.height}mm` });
      for (const position of page.labels) {
        const img = doc.createElement("img"); img.src = labels[position.index].png;
        Object.assign(img.style, { left: `${position.x}mm`, top: `${position.y}mm`, width: `${position.width}mm`, height: `${position.height}mm` });
        section.append(img);
      }
      doc.body.append(section);
    });
    doc.head.append(style);
    await Promise.all(Array.from(doc.images, img => img.decode()));
    await new Promise<void>(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())));
    win.addEventListener("afterprint", () => frame.remove(), { once: true });
    setTimeout(() => frame.remove(), 300000);
    win.focus(); win.print();
  } catch (error) { frame.remove(); throw error; }
}

export async function downloadLabelPdf(labels: LabelSnapshot[], media: PrintMedia) {
  layoutLabelPages(labels, media);
  const response = await fetch("/api/v1/labels/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ labels, media }) });
  if (!response.ok) throw new Error((await response.json()).error ?? "Unable to generate PDF.");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a"); link.href = url; link.download = "inventory-labels.pdf";
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
