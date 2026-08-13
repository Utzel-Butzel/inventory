import type {
  BarcodeDetector,
  BarcodeFormat,
  DetectedBarcode,
} from "barcode-detector/ponyfill";

export const SUPPORTED_BARCODE_FORMATS = [
  "qr_code",
  "data_matrix",
  "aztec",
  "pdf417",
  "code_128",
  "code_93",
  "code_39",
  "codabar",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "itf",
] as const satisfies readonly BarcodeFormat[];

export type ScannedBarcode = {
  value: string;
  format: string;
};

type DetectableImage = Parameters<BarcodeDetector["detect"]>[0];

let detectorPromise: Promise<BarcodeDetector> | null = null;

function createDetector() {
  return import("barcode-detector/ponyfill").then(async (barcodeModule) => {
    await barcodeModule.prepareZXingModule({
      fireImmediately: true,
      overrides: {
        locateFile: (path, prefix) =>
          path.endsWith(".wasm")
            ? "/barcodes/zxing_reader.wasm"
            : `${prefix}${path}`,
      },
    });

    return new barcodeModule.BarcodeDetector({
      formats: [...SUPPORTED_BARCODE_FORMATS],
    });
  });
}

function normalizeBarcodes(barcodes: DetectedBarcode[]): ScannedBarcode[] {
  const seen = new Set<string>();
  const normalized: ScannedBarcode[] = [];

  for (const barcode of barcodes) {
    const value = barcode.rawValue.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push({ value, format: barcode.format });
  }

  return normalized;
}

export async function detectBarcodes(source: DetectableImage) {
  detectorPromise ??= createDetector();

  try {
    return normalizeBarcodes(await (await detectorPromise).detect(source));
  } catch (error) {
    // A failed WASM load should not permanently disable scanning. A later retry
    // can recover after a transient connection or deployment-cache issue.
    detectorPromise = null;
    throw error;
  }
}
