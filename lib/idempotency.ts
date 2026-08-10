import "server-only";

import { createHash } from "node:crypto";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readIdempotencyKey(request: Request) {
  const value = request.headers.get("idempotency-key");
  if (value === null) return { key: null, error: null } as const;
  const normalized = value.trim().toLowerCase();
  if (!uuidPattern.test(normalized)) {
    return {
      key: null,
      error: Response.json(
        { error: "Idempotency-Key must be a UUID." },
        { status: 400 },
      ),
    } as const;
  }
  return { key: normalized, error: null } as const;
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
};

export function hashIdempotentPayload(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export const idempotencyResponseHeaders = (key: string, replayed: boolean) => ({
  "Idempotency-Key": key,
  "Idempotency-Replayed": replayed ? "true" : "false",
});
