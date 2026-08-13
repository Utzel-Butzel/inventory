import "server-only";

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";

import {
  resourceMediaKind,
  storageProviderSupportsMediaType,
  USDZ_MEDIA_TYPE,
  type ResourceMediaKind,
} from "@/lib/resource-media-contract";

export type StorageProvider = "local" | "openinary";

export type StoredMedia = {
  storageKey: string;
  url: string;
  name: string;
  mimeType: string;
  kind: ResourceMediaKind;
  size: number;
  width: number | null;
  height: number | null;
};

export type StoredBinaryAsset = {
  storageKey: string;
  url: string;
  name: string;
  mimeType: string;
  size: number;
  checksumSha256: string;
};

const localRoot = () =>
  path.resolve(process.env.STORAGE_LOCAL_PATH ?? path.join(process.cwd(), "data/uploads"));

const safeFilename = (value: string) => {
  const sanitized = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return sanitized.slice(0, 160) || "file";
};

const validateStorageKey = (key: string) => {
  const segments = key.split("/").filter(Boolean);
  if (
    segments.length < 2 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("Invalid storage key.");
  }
  return segments.join("/");
};

const localPathForKey = (key: string) => {
  const validated = validateStorageKey(key);
  const root = localRoot();
  const resolved = path.resolve(root, validated);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid storage path.");
  }
  return resolved;
};

export const getStorageProvider = (): StorageProvider =>
  process.env.STORAGE_PROVIDER?.trim().toLowerCase() === "openinary"
    ? "openinary"
    : "local";

export const getMediaKind = resourceMediaKind;

export class UnsupportedStorageMediaTypeError extends Error {
  constructor(provider: StorageProvider, mimeType: string) {
    super(
      provider === "openinary" && mimeType === USDZ_MEDIA_TYPE
        ? "The configured Openinary storage provider does not accept USDZ models. Set STORAGE_PROVIDER=local with persistent storage to upload Object Capture models."
        : `The configured ${provider} storage provider does not accept ${mimeType || "this file type"}.`,
    );
    this.name = "UnsupportedStorageMediaTypeError";
  }
}

export const assertStorageSupportsMediaType = (mimeType: string) => {
  const provider = getStorageProvider();
  if (!storageProviderSupportsMediaType(provider, mimeType)) {
    throw new UnsupportedStorageMediaTypeError(provider, mimeType);
  }
};

const imageMetadata = async (bytes: Buffer, mimeType: string) => {
  if (!mimeType.startsWith("image/")) return { width: null, height: null };
  try {
    const metadata = await sharp(bytes, { failOnError: false }).metadata();
    return { width: metadata.width ?? null, height: metadata.height ?? null };
  } catch {
    return { width: null, height: null };
  }
};

const uploadOpeninary = async (
  bytes: Buffer,
  mimeType: string,
  storageKey: string,
) => {
  const baseUrl = process.env.OPENINARY_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.OPENINARY_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    throw new Error("Openinary storage is selected but its URL or API key is missing.");
  }

  const segments = storageKey.split("/");
  const filename = segments.pop()!;
  const form = new FormData();
  form.append("files", new File([new Uint8Array(bytes)], filename, { type: mimeType }));
  form.append("names", filename);
  form.append("folder", segments.join("/"));
  if (mimeType.startsWith("image/")) {
    for (const transformation of ["w_480,q_75", "w_960,q_78", "w_1600,q_82"]) {
      form.append("transformations", transformation);
    }
  }

  const response = await fetch(`${baseUrl}/api/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let payload: {
    files?: Array<{ path?: string; url?: string }>;
    errors?: Array<{ error?: string }>;
  } = {};
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    payload = {};
  }
  const uploaded = payload.files?.[0];
  if (!response.ok || !uploaded?.path) {
    throw new Error(
      payload.errors?.[0]?.error || `Openinary upload failed (HTTP ${response.status}).`,
    );
  }
  return {
    storageKey: uploaded.path.replace(/^\/+/, ""),
    url: `${baseUrl}/t/${uploaded.path.replace(/^\/+/, "")}`,
  };
};

async function storeBytes(options: {
  bytes: Buffer;
  mimeType: string;
  originalName: string;
  folder: string;
}) {
  const filename = `${randomUUID()}-${safeFilename(options.originalName)}`;
  const key = validateStorageKey(`${options.folder}/${filename}`);

  if (getStorageProvider() === "openinary") {
    return uploadOpeninary(options.bytes, options.mimeType, key);
  }

  const target = localPathForKey(key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, options.bytes, { flag: "wx" });
  return {
    storageKey: key,
    url: `/api/files/${key
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`,
  };
}

export async function storeMedia(options: {
  bytes: Buffer;
  mimeType: string;
  originalName: string;
  resourceId: string;
}): Promise<StoredMedia> {
  assertStorageSupportsMediaType(options.mimeType);
  const dimensions = await imageMetadata(options.bytes, options.mimeType);
  const stored = await storeBytes({
    bytes: options.bytes,
    mimeType: options.mimeType,
    originalName: options.originalName,
    folder: `resources/${options.resourceId}`,
  });

  return {
    ...stored,
    name: options.originalName,
    mimeType: options.mimeType,
    kind: getMediaKind(options.mimeType),
    size: options.bytes.length,
    ...dimensions,
  };
}

export async function storeRoomScanAsset(options: {
  bytes: Buffer;
  mimeType: string;
  originalName: string;
  roomScanId: string;
}): Promise<StoredBinaryAsset> {
  const stored = await storeBytes({
    bytes: options.bytes,
    mimeType: options.mimeType,
    originalName: options.originalName,
    folder: `room-scans/${options.roomScanId}`,
  });
  return {
    ...stored,
    name: options.originalName,
    mimeType: options.mimeType,
    size: options.bytes.length,
    checksumSha256: createHash("sha256").update(options.bytes).digest("hex"),
  };
}

export async function readLocalMedia(storageKey: string) {
  return readFile(localPathForKey(storageKey));
}

export async function mediaToDataUrl(item: {
  storageKey: string;
  url: string;
  mimeType: string;
}) {
  let bytes: Buffer;
  if (item.url.startsWith("/api/files/")) {
    bytes = await readLocalMedia(item.storageKey);
  } else {
    const response = await fetch(item.url, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Unable to load source image (HTTP ${response.status}).`);
    }
    bytes = Buffer.from(await response.arrayBuffer());
  }
  return `data:${item.mimeType || "application/octet-stream"};base64,${bytes.toString("base64")}`;
}

export async function readMediaBytes(item: {
  storageKey: string;
  url: string;
}) {
  if (item.url.startsWith("/api/files/")) {
    return readLocalMedia(item.storageKey);
  }
  const response = await fetch(item.url, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Unable to load media (HTTP ${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteStoredMedia(item: {
  storageKey: string;
  url: string;
}) {
  if (item.url.startsWith("/api/files/")) {
    try {
      await unlink(localPathForKey(item.storageKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return;
  }

  const baseUrl = process.env.OPENINARY_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.OPENINARY_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    throw new Error(
      "Unable to delete external media because Openinary is not configured.",
    );
  }
  const storagePath = validateStorageKey(item.storageKey)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const response = await fetch(`${baseUrl}/api/storage/${storagePath}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Openinary delete failed (HTTP ${response.status}).`);
  }
}

export const maxUploadBytes = () => {
  const configured = Number(process.env.MAX_UPLOAD_MB ?? "25");
  return Math.max(1, Math.min(100, Number.isFinite(configured) ? configured : 25)) * 1024 * 1024;
};

export const maxUsdzUploadBytes = () => {
  const configured = Number(process.env.MAX_USDZ_UPLOAD_MB ?? "100");
  return (
    Math.max(10, Math.min(500, Number.isFinite(configured) ? configured : 100)) *
    1024 *
    1024
  );
};

export const maxRoomScanUploadBytes = () => {
  const configured = Number(process.env.MAX_ROOM_SCAN_UPLOAD_MB ?? "100");
  return (
    Math.max(10, Math.min(500, Number.isFinite(configured) ? configured : 100)) *
    1024 *
    1024
  );
};
