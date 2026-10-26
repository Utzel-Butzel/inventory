export const LABEL_SETUP_NAME_CONFLICT = "A label setup with that name already exists.";

export function availableLabelSetupName(base: string, existingNames: string[]) {
  const names = new Set(existingNames.map((name) => name.toLowerCase()));
  const stem = base.trim().slice(0, 160);
  let candidate = stem;
  for (let index = 2; names.has(candidate.toLowerCase()); index += 1) {
    const suffix = ` (${index})`;
    candidate = `${stem.slice(0, 160 - suffix.length)}${suffix}`;
  }
  return candidate;
}

export function isLabelSetupNameConflict(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (typeof error === "object" && error !== null && !seen.has(error)) {
    seen.add(error);
    const failure = error as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (failure.code === "23505" && failure.constraint_name === "label_setups_name_unique") {
      return true;
    }
    // Drizzle wraps the PostgreSQL error; its outer message only contains SQL.
    error = failure.cause;
  }
  return false;
}
