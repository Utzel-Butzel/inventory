export const scanCodeTypes = [
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
] as const;

export type ScanCodeType = (typeof scanCodeTypes)[number];

const scanCodeTypeSet = new Set<string>(scanCodeTypes);

export const isScanCodeType = (value: unknown): value is ScanCodeType =>
  typeof value === "string" && scanCodeTypeSet.has(value);

export const scanCodeTypeLabels: Record<ScanCodeType, string> = {
  qr_code: "QR-Code",
  data_matrix: "Data Matrix",
  aztec: "Aztec",
  pdf417: "PDF417",
  code_128: "Code 128",
  code_93: "Code 93",
  code_39: "Code 39",
  codabar: "Codabar",
  ean_13: "EAN-13",
  ean_8: "EAN-8",
  upc_a: "UPC-A",
  upc_e: "UPC-E",
  itf: "ITF",
};
