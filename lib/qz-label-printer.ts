import { waitForLabelImageCrops } from "@/lib/label-image-crop";
import { labelFontEmbedCss } from "@/lib/label-fonts";
import { combinePtouchLabels, encodePtouchRaster, PTOUCH_FEED_DPI, PTOUCH_PIXELS_PER_MM, ptouchPrintableDots, type PtouchTape } from "@/lib/ptouch-raster";
import { halftonePtouchPhoto } from "@/lib/ptouch-photo";

let connection: Promise<typeof import("qz-tray")> | undefined;

async function connectQz() {
  if (!connection) {
    connection = (async () => {
      const qz = (await import("qz-tray")).default;
      qz.api.showDebug(false);
      // Let the server inspect the complete request before hashing/signing it.
      // QZ's normal hook only receives a SHA-256 hash, which cannot be authorized.
      qz.api.setSha256Type((request) => request);
      // Without configured signing, QZ asks the user to approve access.
      qz.security.setCertificatePromise(async () => {
        const response = await fetch("/api/v1/labels/qz-certificate", { cache: "no-store" });
        if (response.status === 503) return "";
        if (!response.ok) throw new Error("Unable to load QZ certificate.");
        return response.text();
      }, { rejectOnFailure: true });
      qz.security.setSignatureAlgorithm("SHA512");
      qz.security.setSignaturePromise(async (request) => {
        const response = await fetch("/api/v1/labels/qz-sign", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request }),
        });
        if (response.status === 503) return "";
        if (!response.ok) throw new Error("Unable to sign QZ print request.");
        return response.text();
      });
      if (!qz.websocket.isActive()) await qz.websocket.connect();
      qz.websocket.setClosedCallbacks(() => { connection = undefined; });
      return qz;
    })().catch((error) => { connection = undefined; throw error; });
  }
  return connection;
}

export async function findPtouchPrinters(): Promise<string[]> {
  const qz = await connectQz();
  const printers = await qz.printers.find();
  return (Array.isArray(printers) ? printers : [printers]).filter((name) => /P[ _-]?710BT/i.test(name));
}

export async function renderPtouchLabel(node: HTMLElement, widthMm: number, heightMm: number, tape: PtouchTape, expectedQr?: string) {
  const width = Math.round(widthMm * PTOUCH_FEED_DPI / 25.4);
  const height = Math.round(heightMm * PTOUCH_PIXELS_PER_MM);
  if (height > ptouchPrintableDots(tape) || width < 4 || width > 14116) {
    throw new Error("Label dimensions do not fit the P-touch print area.");
  }
  await waitForLabelImageCrops(node);
  await Promise.all(Array.from(node.querySelectorAll<HTMLImageElement>("img"), image => image.decode()));
  const fontEmbedCSS = await labelFontEmbedCss(node);
  await document.fonts.ready;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const { toCanvas } = await import("html-to-image");
  const canvas = await toCanvas(node, {
    canvasWidth: width, canvasHeight: height, pixelRatio: 1,
    backgroundColor: "#ffffff", skipFonts: !fontEmbedCSS, fontEmbedCSS,
    style: { boxShadow: "none", margin: "0" },
  });
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to render the label.");
  const pixels = context.getImageData(0, 0, width, height);
  const labelBounds = node.getBoundingClientRect();
  for (const photo of node.querySelectorAll<HTMLImageElement>(".printable-label-image")) {
    const bounds = photo.getBoundingClientRect();
    halftonePtouchPhoto(pixels, {
      x: (bounds.left - labelBounds.left) / labelBounds.width * width,
      y: (bounds.top - labelBounds.top) / labelBounds.height * height,
      width: bounds.width / labelBounds.width * width,
      height: bounds.height / labelBounds.height * height,
    }, photo.dataset.labelPhotoOptimization === "standard" ? "standard" : "auto");
  }
  context.putImageData(pixels, 0, 0);
  if (expectedQr) {
    // The physical dots are rectangular (360 along feed, 180 across tape).
    // Check QR readability at square 180-dpi pixels, matching the label's shape.
    const qrCanvas = document.createElement("canvas");
    qrCanvas.width = Math.round(widthMm * PTOUCH_PIXELS_PER_MM);
    // Include the physical, unprinted tape edges in the scan check. On white
    // 24 mm tape these supply ~3 mm of quiet zone above/below a full-height QR.
    qrCanvas.height = Math.round(tape * PTOUCH_PIXELS_PER_MM);
    const qrContext = qrCanvas.getContext("2d");
    if (!qrContext) throw new Error("Unable to validate QR code.");
    qrContext.fillStyle = "#ffffff";
    qrContext.fillRect(0, 0, qrCanvas.width, qrCanvas.height);
    const tapeOffset = Math.floor((qrCanvas.height - height) / 2);
    qrContext.drawImage(canvas, 0, tapeOffset, qrCanvas.width, height);
    const { default: jsQR } = await import("jsqr");
    const qrElements = Array.from(node.querySelectorAll<HTMLElement>("[data-label-qr]"));
    if (!qrElements.length) throw new Error("Unable to validate QR code.");
    // Decode each instance separately: one readable QR must not hide a broken second one.
    const padding = Math.ceil(2 * PTOUCH_PIXELS_PER_MM);
    for (const qr of qrElements) {
      const bounds = qr.getBoundingClientRect();
      const left = (bounds.left - labelBounds.left) / labelBounds.width * qrCanvas.width;
      const top = (bounds.top - labelBounds.top) / labelBounds.height * height + tapeOffset;
      const x = Math.max(0, Math.floor(left - padding));
      const y = Math.max(0, Math.floor(top - padding));
      const scanWidth = Math.min(qrCanvas.width, Math.ceil(left + bounds.width / labelBounds.width * qrCanvas.width + padding)) - x;
      const scanHeight = Math.min(qrCanvas.height, Math.ceil(top + bounds.height / labelBounds.height * height + padding)) - y;
      if (scanWidth <= 0 || scanHeight <= 0) throw new Error("Unable to validate QR code.");
      const qrPixels = qrContext.getImageData(x, y, scanWidth, scanHeight);
      const monochrome = new Uint8ClampedArray(qrPixels.data.length);
      for (let i = 0; i < qrPixels.data.length; i += 4) {
        const value = qrPixels.data[i] * 0.2126 + qrPixels.data[i + 1] * 0.7152 + qrPixels.data[i + 2] * 0.0722 < 128 ? 0 : 255;
        monochrome[i] = monochrome[i + 1] = monochrome[i + 2] = value;
        monochrome[i + 3] = 255;
      }
      if (jsQR(monochrome, scanWidth, scanHeight)?.data !== expectedQr) {
        throw new Error("QR code is too small or unreadable at print resolution. Enlarge it or use wider tape.");
      }
    }
  }
  const preview = document.createElement("canvas");
  preview.width = Math.round(widthMm * PTOUCH_PIXELS_PER_MM);
  preview.height = Math.round(tape * PTOUCH_PIXELS_PER_MM);
  const previewContext = preview.getContext("2d");
  if (!previewContext) throw new Error("Unable to render the label preview.");
  previewContext.fillStyle = "white";
  previewContext.fillRect(0, 0, preview.width, preview.height);
  previewContext.drawImage(canvas, 0, Math.floor((preview.height - height) / 2), preview.width, height);
  return { data: encodePtouchRaster(pixels, tape), preview: preview.toDataURL("image/png") };
}

export async function sendPtouchLabels(printer: string, labels: Uint8Array[]) {
  if (!/P[ _-]?710BT/i.test(printer) || !labels.length || labels.length > 100) {
    throw new Error("Select a PT-P710BT and at most 100 labels.");
  }
  const job = combinePtouchLabels(labels);
  const qz = await connectQz();
  const config = qz.configs.create(printer, { forceRaw: true, jobName: "Inventory labels" });
  // One raw spool job preserves page order and avoids resetting between labels.
  // Never retry automatically: QZ acceptance cannot prove physical printing.
  let binary = "";
  for (let offset = 0; offset < job.length; offset += 8192) {
    binary += String.fromCharCode(...job.subarray(offset, offset + 8192));
  }
  await qz.print(config, [{ type: "raw", format: "command", flavor: "base64", data: btoa(binary) }]);
}
