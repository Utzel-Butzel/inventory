import assert from "node:assert/strict";
import test from "node:test";

import { paidAiRateLimitPolicy } from "../lib/ai-rate-limit-policy.ts";

test("paid AI operations have bounded defaults", () => {
  assert.deepEqual(paidAiRateLimitPolicy("analyze", {}), {
    limit: 10,
    windowMs: 60_000,
  });
  assert.deepEqual(paidAiRateLimitPolicy("count", {}), {
    limit: 10,
    windowMs: 60_000,
  });
  assert.deepEqual(paidAiRateLimitPolicy("cover", {}), {
    limit: 12,
    windowMs: 3_600_000,
  });
  assert.deepEqual(paidAiRateLimitPolicy("translate", {}), {
    limit: 30,
    windowMs: 60_000,
  });
});

test("analysis and counting retain the legacy shared env fallback", () => {
  const environment = { AI_RATE_LIMIT_PER_MINUTE: "7" };
  assert.equal(paidAiRateLimitPolicy("analyze", environment).limit, 7);
  assert.equal(paidAiRateLimitPolicy("count", environment).limit, 7);
});

test("operation-specific env values take precedence", () => {
  const environment = {
    AI_RATE_LIMIT_PER_MINUTE: "7",
    AI_ANALYSIS_RATE_LIMIT_PER_MINUTE: "3",
    AI_COUNT_RATE_LIMIT_PER_MINUTE: "2",
    AI_IMAGE_RATE_LIMIT_PER_HOUR: "4",
    AI_TRANSLATION_RATE_LIMIT_PER_MINUTE: "9",
  };
  assert.equal(paidAiRateLimitPolicy("analyze", environment).limit, 3);
  assert.equal(paidAiRateLimitPolicy("count", environment).limit, 2);
  assert.equal(paidAiRateLimitPolicy("cover", environment).limit, 4);
  assert.equal(paidAiRateLimitPolicy("translate", environment).limit, 9);
});

test("blank specific values still use the legacy fallback", () => {
  const environment = {
    AI_RATE_LIMIT_PER_MINUTE: "6",
    AI_ANALYSIS_RATE_LIMIT_PER_MINUTE: "  ",
    AI_COUNT_RATE_LIMIT_PER_MINUTE: "",
  };
  assert.equal(paidAiRateLimitPolicy("analyze", environment).limit, 6);
  assert.equal(paidAiRateLimitPolicy("count", environment).limit, 6);
});

test("invalid configured limits fail closed", () => {
  for (const value of [
    "-1",
    "1.5",
    "1e2",
    "0x10",
    "+2",
    "NaN",
    "Infinity",
    "1000001",
  ]) {
    assert.equal(
      paidAiRateLimitPolicy("analyze", {
        AI_RATE_LIMIT_PER_MINUTE: "8",
        AI_ANALYSIS_RATE_LIMIT_PER_MINUTE: value,
      }).limit,
      0,
    );
    assert.equal(
      paidAiRateLimitPolicy("cover", {
        AI_IMAGE_RATE_LIMIT_PER_HOUR: value,
      }).limit,
      0,
    );
  }
});

test("zero explicitly disables a paid AI operation", () => {
  assert.equal(
    paidAiRateLimitPolicy("count", {
      AI_COUNT_RATE_LIMIT_PER_MINUTE: "0",
    }).limit,
    0,
  );
  assert.equal(
    paidAiRateLimitPolicy("cover", {
      AI_IMAGE_RATE_LIMIT_PER_HOUR: "0",
    }).limit,
    0,
  );
});
