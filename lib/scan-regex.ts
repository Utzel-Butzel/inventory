export const scanRegexLimits = {
  pattern: 500,
  flags: 4,
  group: 64,
} as const;

const allowedFlags = new Set(["i", "m", "s", "u"]);

const quantifierAt = (pattern: string, index: number) => {
  const character = pattern[index];
  if (character === "*" || character === "+" || character === "?") return true;
  if (character !== "{") return false;
  return /^\{\d+(?:,\d*)?\}/.test(pattern.slice(index));
};

/**
 * Scan regexes run against untrusted code contents. Keep the supported subset
 * deliberately small and reject the common catastrophic-backtracking shapes.
 */
export function scanRegexValidationError(pattern: string, flags: string) {
  if (!pattern) return "A regular expression pattern is required.";
  if (pattern.length > scanRegexLimits.pattern) {
    return `The regular expression must not exceed ${scanRegexLimits.pattern} characters.`;
  }
  if (flags.length > scanRegexLimits.flags) {
    return `At most ${scanRegexLimits.flags} regular expression flags are allowed.`;
  }
  const flagCharacters = [...flags];
  if (
    flagCharacters.some((flag) => !allowedFlags.has(flag)) ||
    new Set(flagCharacters).size !== flagCharacters.length
  ) {
    return "Only the unique regular expression flags i, m, s, and u are allowed.";
  }
  if (/\\(?:[1-9]\d*|k<)/.test(pattern)) {
    return "Regular expression backreferences are not supported in scan flows.";
  }
  if (/\(\?(?:[=!]|<[=!])/.test(pattern)) {
    return "Regular expression lookarounds are not supported in scan flows.";
  }

  const groups: Array<{
    containsAlternation: boolean;
    containsQuantifier: boolean;
  }> = [];
  let escaped = false;
  let characterClass = false;
  let quantifierCount = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") {
      characterClass = true;
      continue;
    }
    if (character === "]" && characterClass) {
      characterClass = false;
      continue;
    }
    if (characterClass) continue;
    if (character === "(") {
      groups.push({ containsAlternation: false, containsQuantifier: false });
      continue;
    }
    if (character === "|") {
      for (const group of groups) group.containsAlternation = true;
      continue;
    }
    if (character === ")") {
      const group = groups.pop();
      if (
        group &&
        (group.containsQuantifier || group.containsAlternation) &&
        quantifierAt(pattern, index + 1)
      ) {
        return "Nested or repeated alternative regular expression quantifiers are not supported in scan flows.";
      }
      continue;
    }
    if (quantifierAt(pattern, index)) {
      quantifierCount += 1;
      for (const group of groups) group.containsQuantifier = true;
      if (quantifierCount > 16) {
        return "The regular expression contains too many repetitions.";
      }
    }
  }
  if (characterClass || groups.length) {
    return "The regular expression contains an unclosed group or character class.";
  }

  try {
    new RegExp(pattern, flags);
  } catch {
    return "The regular expression is invalid.";
  }
  return null;
}

export const scanRegexGroupIsValid = (group: string) =>
  /^(?:0|[1-9]\d{0,2}|[A-Za-z][A-Za-z0-9_]{0,63})$/.test(group);

export function extractScanRegexValue(
  scannedValue: string,
  extraction: { pattern: string; flags?: string; group: string },
) {
  const validationError = scanRegexValidationError(
    extraction.pattern,
    extraction.flags ?? "",
  );
  if (validationError) return { value: null, error: validationError } as const;
  if (!scanRegexGroupIsValid(extraction.group)) {
    return { value: null, error: "The configured capture group is invalid." } as const;
  }
  const match = new RegExp(extraction.pattern, extraction.flags ?? "").exec(
    scannedValue,
  );
  if (!match) {
    return { value: null, error: "The scanned value does not match the regular expression." } as const;
  }
  const numericGroup = /^\d+$/.test(extraction.group)
    ? Number(extraction.group)
    : null;
  const value = (
    numericGroup === null
      ? match.groups?.[extraction.group]
      : match[numericGroup]
  )?.trim();
  return value
    ? ({ value, error: null } as const)
    : ({
        value: null,
        error: `Capture group ${extraction.group} did not contain a value.`,
      } as const);
}

export const escapeScanRegexLiteral = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function scanRegexFromSelection(
  sample: string,
  start: number,
  end: number,
) {
  if (start < 0 || end <= start || end > sample.length) return null;
  return {
    pattern: `^${escapeScanRegexLiteral(sample.slice(0, start))}(?<value>.+?)${escapeScanRegexLiteral(sample.slice(end))}$`,
    flags: "",
    group: "value",
  } as const;
}
