export const MAX_PRINT_LABELS = 100;

/** Repeat an entire ordered series in a single print job. */
export function repeatLabelCopies<T>(labels: readonly T[], copies: number): T[] {
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_PRINT_LABELS || !labels.length || labels.length * copies > MAX_PRINT_LABELS) {
    throw new Error("PTOUCH_BATCH_COUNT");
  }
  return Array.from({ length: copies }, () => labels).flat();
}
