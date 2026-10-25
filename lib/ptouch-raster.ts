// Brother PT-E550W/P750W/P710BT Raster Command Reference v1.02,
// sections 2.3 and 4. A raster line runs across the 128-pin print head.
export const PTOUCH_DPI = 180;
export const PTOUCH_FEED_DPI = 360;
export const PTOUCH_PIXELS_PER_MM = PTOUCH_DPI / 25.4;
export const PTOUCH_MAX_JOB_BYTES = 4_000_000;
export const PTOUCH_TAPES = [3.5, 6, 9, 12, 18, 24] as const;
export type PtouchTape = (typeof PTOUCH_TAPES)[number];

const PRINTABLE_DOTS: Record<PtouchTape, number> = {
  3.5: 24, 6: 32, 9: 50, 12: 70, 18: 112, 24: 128,
};

export function ptouchPrintableDots(tape: number): number {
  const dots = PRINTABLE_DOTS[tape as PtouchTape];
  if (!dots) throw new Error("Unsupported P-touch tape width.");
  return dots;
}

export type LabelPixels = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

/** One complete, cut label. Input dimensions describe the printed content;
 * the printer adds 2 mm on each end and centers it across the tape. */
export function encodePtouchRaster(pixels: LabelPixels, tape: PtouchTape, highResolution = true): Uint8Array {
  const { width, height, data } = pixels;
  const printable = ptouchPrintableDots(tape);
  if (!Number.isInteger(width) || width < 4 || width > (highResolution ? 14116 : 7058) ||
      !Number.isInteger(height) || height < 1 || height > printable ||
      data.length !== width * height * 4) {
    throw new Error("Label dimensions do not fit the P-touch print area.");
  }

  const bytes: number[] = new Array(100).fill(0);
  bytes.push(0x1b, 0x40, 0x1b, 0x69, 0x61, 0x01);
  // Validate both the laminated media type and the requested tape width.
  bytes.push(0x1b, 0x69, 0x7a, 0x86, 0x01, Math.round(tape), 0,
    width & 255, (width >>> 8) & 255, 0, 0, 0, 0);
  bytes.push(0x1b, 0x69, 0x4d, 0x40); // Automatic cut.
  bytes.push(0x1b, 0x69, 0x4b, highResolution ? 0x48 : 0x08); // 180×360 dpi; feed and finish.
  bytes.push(0x1b, 0x69, 0x64, highResolution ? 28 : 14, 0); // 2 mm feed margins.
  bytes.push(0x4d, 0x02); // TIFF/PackBits, buffered printing.

  const offset = Math.floor((128 - height) / 2);
  // Feed goes right to left; the first pin is the bottom of the label.
  for (let x = width - 1; x >= 0; x -= 1) {
    const line = new Uint8Array(16);
    for (let y = 0; y < height; y += 1) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3] / 255;
      const luminance = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) * alpha + 255 * (1 - alpha);
      if (luminance < 128) {
        const pin = offset + height - 1 - y;
        line[pin >>> 3] |= 0x80 >>> (pin & 7);
      }
    }
    // A literal PackBits run keeps the codec simple and all 128 pins explicit.
    bytes.push(0x47, 17, 0, 15, ...line);
  }
  bytes.push(0x1a);
  return Uint8Array.from(bytes);
}

/** Build one Brother multi-page job, with only one initialization and final feed.
 * Input is the standalone format produced by encodePtouchRaster; never mutate it.
 * ESC i z marks subsequent pages, FF continues, Control-Z finishes the series. */
export function combinePtouchLabels(labels: readonly Uint8Array[]): Uint8Array {
  if (!labels.length || labels.length > 100) throw new Error("PTOUCH_BATCH_COUNT");
  let length = 0;
  for (const label of labels) {
    const width = label[113] | (label[114] << 8) | (label[115] << 16) | (label[116] << 24);
    const highResolution = label[126] === 0x48;
    if (label.length !== 135 + width * 20 || width < 4 || width > (highResolution ? 14116 : 7058) ||
        label.slice(0, 100).some(byte => byte !== 0) ||
        label[100] !== 0x1b || label[101] !== 0x40 || label[109] !== 0x86 ||
        label[122] !== 0x40 || ![0x08, 0x48].includes(label[126]) || label.at(-1) !== 0x1a) {
      throw new Error("Invalid prepared P-touch label.");
    }
    if (label[111] !== labels[0][111] || label[126] !== labels[0][126]) throw new Error("PTOUCH_BATCH_MEDIA");
    length += label.length;
  }
  length -= (labels.length - 1) * 102;
  if (length > PTOUCH_MAX_JOB_BYTES) throw new Error("PTOUCH_BATCH_SIZE");
  const job = new Uint8Array(length);
  let offset = 0;
  labels.forEach((label, index) => {
    const skip = index === 0 ? 0 : 102;
    job.set(label.subarray(skip), offset);
    job[offset + 117 - skip] = index === 0 ? 0 : 1;
    const last = index === labels.length - 1;
    job[offset + 126 - skip] = label[126] & (last ? 0xff : 0xf7);
    job[offset + label.length - skip - 1] = last ? 0x1a : 0x0c;
    offset += label.length - skip;
  });
  return job;
}
