import "server-only";

import { runNotificationCycle } from "@/lib/notifications";

type NotificationWorkerState = {
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
};

const workerGlobal = globalThis as typeof globalThis & {
  inventoryNotificationWorker?: NotificationWorkerState;
};

function intervalMilliseconds() {
  const parsed = Number(process.env.NOTIFICATION_WORKER_POLL_MS ?? "900000");
  return Number.isSafeInteger(parsed)
    ? Math.min(86_400_000, Math.max(60_000, parsed))
    : 900_000;
}

export function startNotificationWorker() {
  if (
    process.env.NOTIFICATION_WORKER_ENABLED?.trim().toLowerCase() === "false" ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NODE_ENV === "test"
  ) {
    return;
  }
  const existing = workerGlobal.inventoryNotificationWorker;
  if (existing?.timer) return;
  const state: NotificationWorkerState = existing ?? {
    timer: null,
    running: false,
  };
  workerGlobal.inventoryNotificationWorker = state;
  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await runNotificationCycle();
    } catch (error) {
      console.error("Notification worker tick failed.", error);
    } finally {
      state.running = false;
    }
  };
  const interval = intervalMilliseconds();
  state.timer = setInterval(() => void tick(), interval);
  state.timer.unref();
  const initialTick = setTimeout(() => void tick(), Math.min(10_000, interval));
  initialTick.unref();
}
