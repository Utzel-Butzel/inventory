import "server-only";

import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

import type { ReplicateCountJob } from "@/lib/replicate-count";

const jobSchema = z
  .object({
    predictionId: z.string().trim().min(1).max(160),
    model: z.string().regex(/^[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_.-]*$/iu),
    version: z.string().regex(/^[a-f0-9]{64}$/iu),
    itemHint: z.string().trim().min(1).max(240).optional(),
    prompt: z.string().trim().min(1).max(240),
    maxMasks: z.number().int().min(1).max(100),
    expiresAt: z.string().datetime({ offset: true }),
    subjectHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

type SignedCountJob = z.infer<typeof jobSchema>;

export function validateReplicateCountJobSigningSecret() {
  const secret =
    process.env.REPLICATE_COUNT_JOB_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "REPLICATE_COUNT_JOB_SECRET or AUTH_SECRET must contain at least 32 characters.",
    );
  }
  return secret;
}

function encodeBase64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function signature(payload: string) {
  return createHmac("sha256", validateReplicateCountJobSigningSecret())
    .update(payload)
    .digest();
}

export function createReplicateCountJobToken(options: {
  job: ReplicateCountJob;
  subjectHash: string;
}) {
  const payload = encodeBase64Url(
    JSON.stringify(jobSchema.parse({ ...options.job, subjectHash: options.subjectHash })),
  );
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function readReplicateCountJobToken(options: {
  token: string;
  subjectHash: string;
}): ReplicateCountJob {
  const [payload, encodedSignature, ...extra] = options.token.split(".");
  if (!payload || !encodedSignature || extra.length) {
    throw new Error("Invalid count job token.");
  }
  const expected = signature(payload);
  let actual: Buffer;
  try {
    actual = Buffer.from(encodedSignature, "base64url");
  } catch {
    throw new Error("Invalid count job signature.");
  }
  if (
    actual.toString("base64url") !== encodedSignature ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    throw new Error("Invalid count job signature.");
  }
  let parsed: SignedCountJob;
  try {
    parsed = jobSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
  } catch {
    throw new Error("Invalid count job payload.");
  }
  if (parsed.subjectHash !== options.subjectHash) {
    throw new Error("This count job belongs to another identity.");
  }
  if (Date.parse(parsed.expiresAt) <= Date.now()) {
    throw new Error("This count job has expired.");
  }
  return {
    predictionId: parsed.predictionId,
    model: parsed.model,
    version: parsed.version,
    itemHint: parsed.itemHint,
    prompt: parsed.prompt,
    maxMasks: parsed.maxMasks,
    expiresAt: parsed.expiresAt,
  };
}
