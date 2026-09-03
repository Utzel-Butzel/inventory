"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { WifiOff } from "lucide-react";
import { useOffline } from "next/offline";
import { useT } from "next-i18next/client";

import {
  browserSupportsOfflineMode,
  configureOfflineMode,
  ensureAppServiceWorker,
  readOfflinePreference,
  writeOfflinePreference,
} from "@/lib/offline-support-client";

type OfflineError = "enable" | "disable" | "initialize" | null;

type OfflineSupportContextValue = {
  busy: boolean;
  enabled: boolean;
  error: OfflineError;
  initialized: boolean;
  supported: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
};

const OfflineSupportContext = createContext<OfflineSupportContextValue | null>(
  null,
);

export function OfflineSupportProvider({
  children,
  ownerKey,
}: {
  children: React.ReactNode;
  ownerKey: string;
}) {
  const { t } = useT("shell");
  const isOffline = useOffline();
  const [busy, setBusy] = useState(true);
  const [enabled, setEnabledState] = useState(false);
  const [error, setError] = useState<OfflineError>(null);
  const [initialized, setInitialized] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const available = browserSupportsOfflineMode();
    const preferred = available && readOfflinePreference();
    setSupported(available);
    setEnabledState(preferred);

    if (!available) {
      setBusy(false);
      setInitialized(true);
      return;
    }

    if (!preferred) {
      void ensureAppServiceWorker().catch(() => undefined);
      setBusy(false);
      setInitialized(true);
      return;
    }

    void configureOfflineMode({
      enabled: true,
      ownerKey,
      warmUrl: window.location.href,
    })
      .then(() => {
        if (!cancelled) setError(null);
      })
      .catch(() => {
        if (!cancelled) {
          setEnabledState(false);
          setError("initialize");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false);
          setInitialized(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ownerKey]);

  const setEnabled = useCallback(
    async (nextEnabled: boolean) => {
      setBusy(true);
      setError(null);
      try {
        await configureOfflineMode({
          enabled: nextEnabled,
          ownerKey,
          warmUrl: nextEnabled ? window.location.href : undefined,
        });
        writeOfflinePreference(nextEnabled);
        setEnabledState(nextEnabled);
        if (nextEnabled) {
          void navigator.storage?.persist?.().catch(() => false);
        }
      } catch {
        setError(nextEnabled ? "enable" : "disable");
        throw new Error(nextEnabled ? "enable" : "disable");
      } finally {
        setBusy(false);
      }
    },
    [ownerKey],
  );

  const value = useMemo<OfflineSupportContextValue>(
    () => ({
      busy,
      enabled,
      error,
      initialized,
      supported,
      setEnabled,
    }),
    [busy, enabled, error, initialized, setEnabled, supported],
  );

  return (
    <OfflineSupportContext.Provider value={value}>
      {children}
      {isOffline ? (
        <div
          role="status"
          className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[80] mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-2.5 rounded-xl border border-warning-border bg-warning-soft px-4 py-3 text-[14px] font-semibold text-warning shadow-xl"
        >
          <WifiOff className="size-4 shrink-0" aria-hidden="true" />
          <span>
            {t(
              enabled
                ? "offline.bannerSaved"
                : "offline.bannerReconnect",
            )}
          </span>
        </div>
      ) : null}
    </OfflineSupportContext.Provider>
  );
}

export function useOfflineSupport() {
  const context = useContext(OfflineSupportContext);
  if (!context) {
    throw new Error(
      "Offline support must be used inside OfflineSupportProvider.",
    );
  }
  return context;
}

export function OfflineSupportSetting() {
  const { t } = useT("settings");
  const { busy, enabled, error, initialized, setEnabled, supported } =
    useOfflineSupport();

  const message = !initialized
    ? t("user.offline.checking")
    : !supported
      ? t("user.offline.unsupported")
      : busy
        ? t(enabled ? "user.offline.disabling" : "user.offline.enabling")
        : error
          ? t(`user.offline.errors.${error}`)
          : t(enabled ? "user.offline.enabled" : "user.offline.disabled");

  return (
    <div className="flex max-w-md flex-col items-start gap-2 sm:items-end">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={t("user.offline.selectionLabel")}
        disabled={!initialized || !supported || busy}
        onClick={() => void setEnabled(!enabled).catch(() => undefined)}
        className={`relative h-7 w-12 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-50 ${
          enabled
            ? "border-brand bg-brand-solid"
            : "border-border-strong bg-surface-muted"
        }`}
      >
        <span
          className={`absolute top-0.5 grid size-[22px] place-items-center rounded-full bg-white shadow-sm transition-transform ${
            enabled ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
          aria-hidden="true"
        />
      </button>
      <p
        className={`min-h-4 text-left text-xs sm:text-right ${error ? "text-danger" : "text-muted"}`}
        aria-live="polite"
      >
        {message}
      </p>
    </div>
  );
}
