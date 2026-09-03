"use client";

const OFFLINE_PREFERENCE_KEY = "open-inventory-offline-enabled";
const OFFLINE_CACHE_PREFIX = "open-inventory-offline";
const SERVICE_WORKER_URL = "/notification-sw.js";
const SERVICE_WORKER_SCOPE = "/";
const WORKER_TIMEOUT_MS = 8_000;

type OfflineConfiguration = {
  enabled: boolean;
  ownerKey?: string;
  warmUrl?: string;
};

type OfflineWorkerReply = {
  ok: boolean;
  enabled?: boolean;
  message?: string;
};

export function browserSupportsOfflineMode() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "caches" in window
  );
}

export function readOfflinePreference() {
  try {
    return window.localStorage.getItem(OFFLINE_PREFERENCE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeOfflinePreference(enabled: boolean) {
  try {
    if (enabled) {
      window.localStorage.setItem(OFFLINE_PREFERENCE_KEY, "true");
    } else {
      window.localStorage.removeItem(OFFLINE_PREFERENCE_KEY);
    }
  } catch {
    // The worker state remains authoritative if storage is unavailable.
  }
}

export async function ensureAppServiceWorker() {
  if (!browserSupportsOfflineMode()) {
    throw new Error("Service workers are not supported by this browser.");
  }
  return navigator.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: SERVICE_WORKER_SCOPE,
    updateViaCache: "none",
  });
}

function waitForWorkerState(worker: ServiceWorker) {
  if (worker.state === "activated") return Promise.resolve(worker);

  return new Promise<ServiceWorker>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("The offline worker did not become ready."));
    }, WORKER_TIMEOUT_MS);
    const onStateChange = () => {
      if (worker.state === "activated") {
        cleanup();
        resolve(worker);
      } else if (worker.state === "redundant") {
        cleanup();
        reject(new Error("The offline worker could not be activated."));
      }
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      worker.removeEventListener("statechange", onStateChange);
    };

    worker.addEventListener("statechange", onStateChange);
    onStateChange();
  });
}

async function activeWorker(registration: ServiceWorkerRegistration) {
  const pending = registration.installing ?? registration.waiting;
  if (pending) return waitForWorkerState(pending);
  if (registration.active) return registration.active;

  const readyRegistration = await navigator.serviceWorker.ready;
  if (!readyRegistration.active) {
    throw new Error("The offline worker is unavailable.");
  }
  return readyRegistration.active;
}

function postConfiguration(
  worker: ServiceWorker,
  configuration: OfflineConfiguration,
) {
  return new Promise<OfflineWorkerReply>((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      reject(new Error("The offline worker did not respond."));
    }, WORKER_TIMEOUT_MS);

    channel.port1.onmessage = (event: MessageEvent<OfflineWorkerReply>) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      if (event.data?.ok) {
        resolve(event.data);
      } else {
        reject(new Error(event.data?.message ?? "Offline setup failed."));
      }
    };

    worker.postMessage(
      {
        type: "OPEN_INVENTORY_OFFLINE_CONFIG",
        enabled: configuration.enabled,
        ownerKey: configuration.ownerKey,
        warmUrl: configuration.warmUrl,
      },
      [channel.port2],
    );
  });
}

export async function configureOfflineMode(
  configuration: OfflineConfiguration,
) {
  if (!browserSupportsOfflineMode()) {
    throw new Error("Offline mode is not supported by this browser.");
  }

  const registration = configuration.enabled
    ? await ensureAppServiceWorker()
    : await navigator.serviceWorker.getRegistration(SERVICE_WORKER_SCOPE);

  if (!registration) return { ok: true, enabled: false };
  const worker = await activeWorker(registration);
  return postConfiguration(worker, configuration);
}

async function purgeOfflineCaches() {
  if (!("caches" in window)) return;
  const names = await window.caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(OFFLINE_CACHE_PREFIX))
      .map((name) => window.caches.delete(name)),
  );
}

export async function disableOfflineModeBeforeSignOut() {
  const wasEnabled = readOfflinePreference();
  writeOfflinePreference(false);
  try {
    if (wasEnabled && browserSupportsOfflineMode()) {
      await configureOfflineMode({ enabled: false });
    }
  } finally {
    await purgeOfflineCaches();
  }
}
