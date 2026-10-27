"use client";

import { prepareUpload } from "@/lib/client-media";

export async function prepareBulkCountPhoto(file: File): Promise<File> {
  const heic = /\.(heic|heif)$/i.test(file.name) || /^image\/(heic|heif)(-sequence)?$/i.test(file.type);
  if (!heic) return prepareUpload(file);
  // Load the decoder only for HEIC photos. Conversion stays on the device;
  // the server receives a JPEG and need not relax its HEIF security limits.
  const { heicTo } = await import("heic-to/csp");
  const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.9 });
  return prepareUpload(new File([jpeg], file.name.replace(/\.(heic|heif)$/i, "") + ".jpg", {
    type: "image/jpeg", lastModified: file.lastModified,
  }));
}
