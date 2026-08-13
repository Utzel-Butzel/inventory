import "server-only";

import { drainWebhookDeliveries } from "@/lib/webhooks";

type WorkerState = {
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
};

const workerGlobal = globalThis as typeof globalThis & {
  inventoryWebhookWorker?: WorkerState;
};

function pollMilliseconds() {
  const value = Number(process.env.WEBHOOK_WORKER_POLL_MS ?? "2000");
  return Number.isSafeInteger(value)
    ? Math.min(60_000, Math.max(500, value))
    : 2_000;
}

function concurrency() {
  const value = Number(process.env.WEBHOOK_WORKER_CONCURRENCY ?? "4");
  return Number.isSafeInteger(value) ? Math.min(20, Math.max(1, value)) : 4;
}

export function startWebhookWorker() {
  if (
    process.env.WEBHOOK_WORKER_ENABLED?.trim().toLowerCase() === "false" ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NODE_ENV === "test"
  ) {
    return;
  }
  const state = workerGlobal.inventoryWebhookWorker ?? {
    timer: null,
    running: false,
  };
  workerGlobal.inventoryWebhookWorker = state;
  if (state.timer) return;
  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await drainWebhookDeliveries(concurrency());
    } catch (error) {
      console.error("Webhook worker tick failed.", error);
    } finally {
      state.running = false;
    }
  };
  const interval = pollMilliseconds();
  state.timer = setInterval(() => void tick(), interval);
  state.timer.unref();
  const initialTick = setTimeout(() => void tick(), Math.min(1_000, interval));
  initialTick.unref();
}
