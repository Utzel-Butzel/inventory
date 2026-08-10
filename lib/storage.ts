import "server-only";

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

export type StorageProvider = "local" | "openinary";

export type StoredMedia = {
  storageKey: string;
  url: string;
  name: string;
  mimeType: string;
  kind: "image" | "video" | "document" | "unknown";
  size: number;
  width: number | null;
  height: number | null;
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

export const getMediaKind = (mimeType: string): StoredMedia["kind"] => {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "application/pdf") return "document";
  return "unknown";
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

export async function storeMedia(options: {
  bytes: Buffer;
  mimeType: string;
  originalName: string;
  resourceId: string;
}): Promise<StoredMedia> {
  const filename = `${randomUUID()}-${safeFilename(options.originalName)}`;
  const key = validateStorageKey(`resources/${options.resourceId}/${filename}`);
  const dimensions = await imageMetadata(options.bytes, options.mimeType);

  let stored: { storageKey: string; url: string };
  if (getStorageProvider() === "openinary") {
    stored = await uploadOpeninary(options.bytes, options.mimeType, key);
  } else {
    const target = localPathForKey(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, options.bytes, { flag: "wx" });
    stored = {
      storageKey: key,
      url: `/api/files/${key
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/")}`,
    };
  }

  return {
    ...stored,
    name: options.originalName,
    mimeType: options.mimeType,
    kind: getMediaKind(options.mimeType),
    size: options.bytes.length,
    ...dimensions,
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
