"use client";

import imageCompression from "browser-image-compression";
import ExifReader from "exifreader";

export type ImageGps = { latitude: number; longitude: number; altitude?: number };

export function imageGpsFromExifTags(
  tags: Record<string, unknown>,
): ImageGps | null {
  const gps = (tags.gps ?? {}) as Record<string, unknown>;
  const latitude = gps.Latitude;
  const longitude = gps.Longitude;
  const altitude = gps.Altitude;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }
  return {
    latitude,
    longitude,
    ...(typeof altitude === "number" && Number.isFinite(altitude)
      ? { altitude }
      : {}),
  };
}

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
    return imageGpsFromExifTags(tags);
  } catch {
    return null;
  }
}
