import type {
  ApiTokenRecord,
  MediaRecord,
  ResourceRecord,
} from "@/db/schema";

export type ClientMedia = Omit<MediaRecord, "createdAt"> & {
  createdAt: string;
};

export type ClientResource = Omit<
  ResourceRecord,
  "createdAt" | "updatedAt"
> & {
  createdAt: string;
  updatedAt: string;
  media: ClientMedia[];
  cover: ClientMedia | null;
};

export type ClientApiToken = Omit<
  ApiTokenRecord,
  "tokenHash" | "revokedAt" | "createdAt" | "expiresAt" | "lastUsedAt"
> & {
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
};

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  const text = await response.text();
  let payload: (T & { error?: string }) | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as T & { error?: string };
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed (HTTP ${response.status}).`);
  }
  return payload as T;
}
