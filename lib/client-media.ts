"use client";

import imageCompression from "browser-image-compression";
import ExifReader from "exifreader";

export type ImageGps = { latitude: number; longitude: number; altitude?: number };

const numericTag = (tag: unknown) => {
  if (!tag || typeof tag !== "object") return null;
  const value = "value" in tag ? (tag as { value: unknown }).value : null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export async function prepareUpload(file: File) {
  if (!file.type.startsWith("image/") || file.size < 1_500_000) return file;
  return imageCompression(file, {
    maxWidthOrHeight: 2200,
    maxSizeMB: 4,
    useWebWorker: true,
    preserveExif: true,
    fileType: file.type,
  });
}

export async function readImageGps(file: File): Promise<ImageGps | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    const tags = ExifReader.load(await file.arrayBuffer(), {
      expanded: true,
      computed: true,
    }) as unknown as Record<string, unknown>;
    const gps = (tags.gps ?? {}) as Record<string, unknown>;
    const latitude = Number(gps.Latitude);
    const longitude = Number(gps.Longitude);
    const altitude = numericTag(tags.GPSAltitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      latitude,
      longitude,
      ...(altitude !== null ? { altitude } : {}),
    };
  } catch {
    return null;
  }
}
