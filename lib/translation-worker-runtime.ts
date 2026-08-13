import "server-only";

import { drainTranslationJobs } from "@/lib/content-translations";

type TranslationWorkerState = {
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
};

const workerGlobal = globalThis as typeof globalThis & {
  inventoryTranslationWorker?: TranslationWorkerState;
};

const configuredInteger = (
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
};

export function startTranslationWorker() {
  if (
    process.env.TRANSLATION_WORKER_ENABLED?.trim().toLowerCase() === "false" ||
    process.env.NEXT_PHASE === "phase-production-build"
  ) {
    return;
  }
  const existing = workerGlobal.inventoryTranslationWorker;
  if (existing?.timer) return;

  const state: TranslationWorkerState = existing ?? {
    timer: null,
    running: false,
  };
  workerGlobal.inventoryTranslationWorker = state;
  const pollIntervalMs = configuredInteger(
    process.env.TRANSLATION_WORKER_POLL_MS,
    2_000,
    500,
    60_000,
  );
  const concurrency = configuredInteger(
    process.env.TRANSLATION_WORKER_CONCURRENCY,
    1,
    1,
    8,
  );

  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await Promise.all(
        Array.from({ length: concurrency }, () => drainTranslationJobs(1)),
      );
    } catch (error) {
      console.error("Translation worker tick failed.", error);
    } finally {
      state.running = false;
    }
  };

  state.timer = setInterval(() => void tick(), pollIntervalMs);
  state.timer.unref();
  const initialTick = setTimeout(() => void tick(), Math.min(1_000, pollIntervalMs));
  initialTick.unref();
}
