import assert from "node:assert/strict";
import test from "node:test";

import {
  createReplicateCountJobToken,
  readReplicateCountJobToken,
} from "../lib/replicate-count-job.ts";

process.env.REPLICATE_COUNT_JOB_SECRET = "test-count-job-secret-that-is-at-least-32-characters";

const subjectHash = "a".repeat(64);
const job = {
  predictionId: "prediction-123",
  model: "yodagg/sam3-image-seg",
  version: "b".repeat(64),
  itemHint: "Platine (Rev B)",
  prompt: "Platine (Rev B)",
  maxMasks: 100,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

test("round-trips a signed count job for the creating identity", () => {
  const token = createReplicateCountJobToken({ job, subjectHash });
  assert.deepEqual(readReplicateCountJobToken({ token, subjectHash }), job);
});

test("rejects tampered or cross-identity count jobs", () => {
  const token = createReplicateCountJobToken({ job, subjectHash });
  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assert.throws(() => readReplicateCountJobToken({ token: tampered, subjectHash }));
  assert.throws(() =>
    readReplicateCountJobToken({ token, subjectHash: "c".repeat(64) }),
  );
});

test("rejects expired count jobs", () => {
  const expired = { ...job, expiresAt: new Date(Date.now() - 1_000).toISOString() };
  const token = createReplicateCountJobToken({ job: expired, subjectHash });
  assert.throws(() => readReplicateCountJobToken({ token, subjectHash }));
});
