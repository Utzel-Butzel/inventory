export const paidAiOperations = [
  "analyze",
  "recognize",
  "count",
  "cover",
  "translate",
] as const;

export type PaidAiOperation = (typeof paidAiOperations)[number];

export type PaidAiRateLimitPolicy = {
  limit: number;
  windowMs: number;
};

type Environment = Record<string, string | undefined>;

const maximumConfiguredLimit = 1_000_000;

const operationPolicies: Record<
  PaidAiOperation,
  {
    environmentVariable: string;
    legacyEnvironmentVariable?: string;
    defaultLimit: number;
    windowMs: number;
  }
> = {
  analyze: {
    environmentVariable: "AI_ANALYSIS_RATE_LIMIT_PER_MINUTE",
    legacyEnvironmentVariable: "AI_RATE_LIMIT_PER_MINUTE",
    defaultLimit: 10,
    windowMs: 60_000,
  },
  recognize: {
    environmentVariable: "AI_RECOGNITION_RATE_LIMIT_PER_MINUTE",
    legacyEnvironmentVariable: "AI_RATE_LIMIT_PER_MINUTE",
    defaultLimit: 10,
    windowMs: 60_000,
  },
  count: {
    environmentVariable: "AI_COUNT_RATE_LIMIT_PER_MINUTE",
    legacyEnvironmentVariable: "AI_RATE_LIMIT_PER_MINUTE",
    defaultLimit: 10,
    windowMs: 60_000,
  },
  cover: {
    environmentVariable: "AI_IMAGE_RATE_LIMIT_PER_HOUR",
    defaultLimit: 12,
    windowMs: 60 * 60_000,
  },
  translate: {
    environmentVariable: "AI_TRANSLATION_RATE_LIMIT_PER_MINUTE",
    defaultLimit: 30,
    windowMs: 60_000,
  },
};

const parseConfiguredLimit = (value: string) => {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) &&
    parsed >= 0 &&
    parsed <= maximumConfiguredLimit
    ? parsed
    : null;
};

const resolveLimit = (
  environment: Environment,
  options: (typeof operationPolicies)[PaidAiOperation],
) => {
  const variableNames = [
    options.environmentVariable,
    options.legacyEnvironmentVariable,
  ].filter((name): name is string => Boolean(name));

  for (const variableName of variableNames) {
    const configured = environment[variableName]?.trim();
    if (!configured) continue;
    // A malformed explicit budget must never increase provider spend. Disable
    // the operation until its configuration is corrected.
    return parseConfiguredLimit(configured) ?? 0;
  }
  return options.defaultLimit;
};

/**
 * Resolve one paid AI operation's request budget. A configured value of zero
 * intentionally disables that operation without requiring provider keys to be
 * removed. Invalid explicit values fail closed by disabling the operation.
 */
export function paidAiRateLimitPolicy(
  operation: PaidAiOperation,
  environment: Environment = process.env,
): PaidAiRateLimitPolicy {
  const options = operationPolicies[operation];
  return {
    limit: resolveLimit(environment, options),
    windowMs: options.windowMs,
  };
}
