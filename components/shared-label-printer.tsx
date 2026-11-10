"use client";
import { LabelHelp } from "@/components/label-help";
import { useEffect, useRef, useState } from "react";
import { useT } from "next-i18next/client";
import { fetchJson } from "@/lib/client-types";
import type {
  SharedPrinter,
} from "@/lib/shared-label-print-contract";
import { effectivePrinterState } from "@/lib/printer-status";
import { Button } from "@/components/ui";

export function SharedLabelPrinter({
  printerId,
  onSelect,
  disabled = false,
  canManage = false,
}: {
  printerId: string;
  onSelect: (printer: SharedPrinter | null) => void;
  disabled?: boolean;
  canManage?: boolean;
}) {
  const { t } = useT("labels");
  const [printers, setPrinters] = useState<SharedPrinter[]>([]);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [checking, setChecking] = useState(false);
  const [requestedCheck, setRequestedCheck] = useState<{ id: string; previous: string | null } | null>(null);
  const [bluetoothAddress, setBluetoothAddress] = useState("");
  const [localBluetooth, setLocalBluetooth] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<"system" | "ptouch">("system");
  const [queueName, setQueueName] = useState("");
  const [location, setLocation] = useState("");
  const [newTape, setNewTape] = useState(24);
  const [maxWidth, setMaxWidth] = useState(210), [maxHeight, setMaxHeight] = useState(297);
  const selectionKey = useRef("");
  const [creating, setCreating] = useState(false);
  const [download, setDownload] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (download) URL.revokeObjectURL(download);
    },
    [download],
  );
  const createPrinter = async () => {
    setCreating(true);
    setError("");
    try {
      const result = await fetchJson<{
        printer: SharedPrinter;
        token: string;
      }>("/api/v1/label-printers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, kind: newKind, location, tape: newTape, maxWidthMm: newKind === "ptouch" ? 1000 : maxWidth, maxHeightMm: newKind === "ptouch" ? 1000 : maxHeight }),
      });
      const blob = new Blob(
        [
          JSON.stringify(
            {
              server: window.location.origin,
              printer: queueName.trim(),
              kind: newKind,
              token: result.token,
              ...(localBluetooth && newKind === "ptouch" ? { bluetoothAddress: bluetoothAddress.trim(), bluetoothHelper: "/REPLACE/WITH/ABSOLUTE/PATH/inventory-ptouch-bluetooth" } : {}),
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      );
      setDownload(URL.createObjectURL(blob));
      setPrinters(all => [...all, { ...result.printer, online: false, enabled: true }]);
      onSelect({ ...result.printer, online: false, enabled: true });
      setNewName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const p = await fetchJson<{ printers: SharedPrinter[] }>("/api/v1/label-printers", {
          cache: "no-store", signal: controller.signal,
        });
        setPrinters(p.printers);
        setError("");
        setLoaded(true);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : t("shared.loadError"));
          setPrinters(current => current.map(p => ({ ...p, online: false, telemetry: null })));
        }
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    window.addEventListener("inventory:print-jobs", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("inventory:print-jobs", refresh);
    };
  }, [t, refreshKey]);
  useEffect(() => {
    if (!loaded) return;
    const selected = printers.find(p => p.id === printerId) ?? null;
    const key = JSON.stringify(selected);
    if (key !== selectionKey.current) { selectionKey.current = key; onSelect(selected); }
  }, [printers, printerId, loaded, onSelect]);
  const selected = printers.find((p) => p.id === printerId);
  const deviceState = selected ? effectivePrinterState(selected.online, selected.telemetry, selected.checkedAt) : "unknown";
  const requestStatus = async () => {
    if (!selected) return;
    setChecking(true); setError("");
    try {
      await fetchJson("/api/v1/label-printers/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selected.id }) });
      setRequestedCheck({ id: selected.id, previous: selected.checkedAt ?? null });
      setRefreshKey(key => key + 1);
    } catch (error) { setError(String(error)); }
    finally { setChecking(false); }
  };
  return (
    <div className="mt-3 space-y-3">
      <label className="text-sm font-medium">
        {t("shared.printer")}
        <select
          aria-label={t("shared.printer")}
          className="ml-0 max-w-full rounded-lg border border-border bg-surface p-2 sm:ml-3"
          value={printerId}
          disabled={disabled || !printers.length}
          onChange={(e) => {
            const p = printers.find((p) => p.id === e.target.value);
            onSelect(p ?? null);
          }}
        >
          <option value="">{t(!loaded ? "shared.loading" : printers.length ? "shared.choose" : "shared.empty")}</option>
          {printers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.location ? ` · ${p.location}` : ""} · {p.kind === "ptouch" ? `${p.tape} mm` : t("shared.system")} ·{" "}
              {t(`shared.deviceState.${effectivePrinterState(p.online, p.telemetry, p.checkedAt)}`)}
            </option>
          ))}
        </select>
      </label>

      {selected ? <section className="rounded-xl border border-border bg-surface p-4" aria-label={t("shared.connection")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">{selected.name}{selected.location ? ` · ${selected.location}` : ""}</p>
            <p className="mt-1 text-sm" role="status">{t("shared.device")}: <strong className={deviceState === "ready" ? "text-emerald-700 dark:text-emerald-400" : ["offline", "error", "unreachable"].includes(deviceState) ? "text-warning" : "text-muted"}>{t(`shared.deviceState.${deviceState}`)}</strong></p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void requestStatus()} disabled={checking || !selected.online || (selected.agentVersion ?? 1) < 2}>{t(checking ? "shared.checking" : "shared.check")}</Button>
        </div>
        {requestedCheck?.id === selected.id && requestedCheck.previous === (selected.checkedAt ?? null) && selected.online ? <p role="status" className="mt-2 text-xs text-muted">{t("shared.checkRequested")}</p> : null}
        <p className="mt-2 text-sm">{selected.telemetry?.device ?? t("shared.deviceUnknown")}</p>
        <p className="mt-1 text-xs text-muted">{t(selected.online ? "shared.online" : "shared.offline")}{selected.telemetry?.host ? ` · ${selected.telemetry.host}` : ""}{selected.telemetry ? ` · ${t(`shared.transport.${selected.telemetry.transport}`)}` : ""}</p>
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
          <span>{selected.kind === "ptouch" ? selected.telemetry?.tape != null && deviceState !== "unknown" && deviceState !== "offline" ? t("shared.detectedTape", { tape: selected.telemetry.tape }) : t("shared.configuredTape", { tape: selected.tape }) : null}</span>
          <LabelHelp>
        {selected.lastSeenAt ? <p className="mt-1 text-xs text-muted">{t("shared.lastSeen", { time: new Date(selected.lastSeenAt).toLocaleString() })}</p> : null}
        <p className="mt-1 text-xs text-muted">{selected.checkedAt ? t("shared.checkedAt", { time: new Date(selected.checkedAt).toLocaleString() }) : t("shared.neverChecked")}</p>

        {!selected.online ? <p className="mt-2">{t("shared.offlineHelp")}</p> : null}
        {(selected.agentVersion ?? 1) < 2 ? <p className="mt-2">{t("shared.upgradeHelp")}</p> : null}
        {deviceState === "unknown" ? <p className="mt-2 text-xs text-muted">{t("shared.unknownHelp")}</p> : null}
          </LabelHelp>
        </div>
      </section> : null}
      {error ? (
        <p role="alert" className="text-sm text-warning">
          {error}
        </p>
      ) : null}
      {canManage ? (
        <details className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {t("shared.setup")}
          </summary>
          <div className="my-2 flex items-center gap-2 text-sm"><a href="/api/v1/label-printers/agent" className="underline">{t("shared.downloadAgent")}</a><LabelHelp><p>{t("shared.setupHelp")}</p><p className="mt-2">{t("shared.installHelp")}</p></LabelHelp></div>
          <label className="text-sm">
            {t("shared.name")}
            <input
              className="ml-2 rounded-lg border border-border bg-surface p-2"
              value={newName}
              maxLength={120}
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>
          <div className="my-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="grid min-w-0 gap-1 text-sm">{t("shared.kind")}<select value={newKind} onChange={event => setNewKind(event.target.value as "system" | "ptouch")} className="min-w-0 w-full rounded-lg border border-border bg-surface p-2">
              <option value="system">{t("shared.system")}</option><option value="ptouch">Brother PT-P710BT</option>
            </select></label>
            <label className="grid min-w-0 gap-1 text-sm">{t(localBluetooth && newKind === "ptouch" ? "shared.localDeviceName" : "shared.queueName")}<input value={queueName} maxLength={200} onChange={event => setQueueName(event.target.value)} className="min-w-0 w-full rounded-lg border border-border bg-surface p-2" /></label>
            <label className="grid min-w-0 gap-1 text-sm">{t("shared.location")}<input value={location} maxLength={120} onChange={event => setLocation(event.target.value)} className="min-w-0 w-full rounded-lg border border-border bg-surface p-2" /></label>
            {newKind === "system" ? <>
              <label className="grid min-w-0 gap-1 text-sm">{t("shared.maxWidth")}<input type="number" min={1} max={1000} value={maxWidth} onChange={event => setMaxWidth(event.target.valueAsNumber || 0)} className="min-w-0 w-full rounded-lg border border-border bg-surface p-2" /></label>
              <label className="grid min-w-0 gap-1 text-sm">{t("shared.maxHeight")}<input type="number" min={1} max={1000} value={maxHeight} onChange={event => setMaxHeight(event.target.valueAsNumber || 0)} className="min-w-0 w-full rounded-lg border border-border bg-surface p-2" /></label>
            </> : <label className="grid min-w-0 gap-1 text-sm">{t("direct.tape")}<select value={newTape} onChange={event => setNewTape(Number(event.target.value))} className="min-w-0 w-full rounded-lg border border-border bg-surface p-2">{[3.5,6,9,12,18,24].map(width => <option key={width} value={width}>{width} mm</option>)}</select></label>}
          </div>
          {newKind === "ptouch" ? <div className="my-3 space-y-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={localBluetooth} onChange={event => { setLocalBluetooth(event.target.checked); if (event.target.checked && !queueName) setQueueName("PT-P710BT"); }} />{t("shared.macBluetooth")}</label>
            {localBluetooth ? <label className="grid gap-1 text-sm">{t("shared.bluetoothAddress")}<input value={bluetoothAddress} placeholder="AA:BB:CC:DD:EE:FF" onChange={event => setBluetoothAddress(event.target.value)} className="rounded-lg border border-border bg-surface p-2" /><span className="text-xs text-muted">{t("shared.bluetoothSetup")}</span></label> : null}
          </div> : null}
          <Button
            className="ml-2"
            size="sm"
            disabled={creating || (localBluetooth && newKind === "ptouch" && !/^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i.test(bluetoothAddress.trim())) || !newName.trim() || !queueName.trim() || (newKind === "system" && (maxWidth <= 0 || maxWidth > 1000 || maxHeight <= 0 || maxHeight > 1000))}
            onClick={() => void createPrinter()}
          >
            {t("shared.create")}
          </Button>
          {download ? (
            <p className="mt-2 text-sm">
              <a className="underline" href={download} download="config.json">
                {t("shared.download")}
              </a>
            </p>
          ) : null}
          {printers.map((p) => (
            <div
              key={p.id}
              className="mt-2 flex items-center justify-between text-xs"
            >
              <span>{p.name}</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void fetchJson("/api/v1/label-printers", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: p.id, enabled: false }),
                  })
                    .then(() =>
                      setPrinters((all) => all.filter((v) => v.id !== p.id)),
                    )
                    .catch((e) => setError(String(e)));
                }}
              >
                {t("shared.disable")}
              </Button>
            </div>
          ))}
        </details>
      ) : null}

    </div>
  );
}
