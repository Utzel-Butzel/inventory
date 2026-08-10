type Bucket = { count: number; resetsAt: number };

const globalBuckets = globalThis as unknown as {
  inventoryRateLimits?: Map<string, Bucket>;
};

const buckets = globalBuckets.inventoryRateLimits ?? new Map<string, Bucket>();
if (process.env.NODE_ENV !== "production") {
  globalBuckets.inventoryRateLimits = buckets;
}

export function checkRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetsAt <= now) {
    buckets.set(key, { count: 1, resetsAt: now + options.windowMs });
    return { allowed: true, remaining: options.limit - 1 };
  }
  if (current.count >= options.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetsAt - now) / 1000)),
    };
  }
  current.count += 1;
  return { allowed: true, remaining: options.limit - current.count };
}

export function resetRateLimit(key: string) {
  buckets.delete(key);
}
