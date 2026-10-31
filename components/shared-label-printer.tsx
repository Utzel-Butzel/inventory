"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "next-i18next/client";
import { fetchJson } from "@/lib/client-types";
import type {
  SharedPrinter,
  SharedPrintJob,
} from "@/lib/shared-label-print-contract";
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
  const [jobs, setJobs] = useState<SharedPrintJob[]>([]);
  const [error, setError] = useState("");
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
        const [p, j] = await Promise.all([
          fetchJson<{ printers: SharedPrinter[] }>("/api/v1/label-printers", {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetchJson<{ jobs: SharedPrintJob[] }>("/api/v1/label-print-jobs", {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);
        setPrinters(p.printers);
        setJobs(j.jobs);
        setError("");
        setLoaded(true);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : t("shared.loadError"));
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [t]);
  useEffect(() => {
    if (!loaded) return;
    const selected = printers.find(p => p.id === printerId) ?? null;
    const key = JSON.stringify(selected);
    if (key !== selectionKey.current) { selectionKey.current = key; onSelect(selected); }
  }, [printers, printerId, loaded, onSelect]);
  const selected = printers.find((p) => p.id === printerId);
  return (
    <div className="mt-3 space-y-3">
      <label className="text-sm font-medium">
        {t("shared.printer")}
        <select
          aria-label={t("shared.printer")}
          className="ml-3 rounded-lg border border-border bg-surface p-2"
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
              {t(p.online ? "shared.online" : "shared.offline")}
            </option>
          ))}
        </select>
      </label>

      {selected && !selected.online ? (
        <p className="text-sm text-warning">{t("shared.offlineHelp")}</p>
      ) : null}
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
          <p className="my-2 text-xs text-muted">{t("shared.setupHelp")}</p>
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
            <label className="grid min-w-0 gap-1 text-sm">{t("shared.queueName")}<input value={queueName} maxLength={200} onChange={event => setQueueName(event.target.value)} className="min-w-0 w-full rounded-lg border border-border bg-surface p-2" /></label>
            <label className="grid min-w-0 gap-1 text-sm">{t("shared.location")}<input value={location} maxLength={120} onChange={event => setLocation(event.target.value)} className="min-w-0 w-full rounded-lg border border-border bg-surface p-2" /></label>
            {newKind === "system" ? <>
              <label className="grid min-w-0 gap-1 text-sm">{t("shared.maxWidth")}<input type="number" min={1} max={1000} value={maxWidth} onChange={event => setMaxWidth(event.target.valueAsNumber || 0)} className="min-w-0 w-full rounded-lg border border-border bg-surface p-2" /></label>
              <label className="grid min-w-0 gap-1 text-sm">{t("shared.maxHeight")}<input type="number" min={1} max={1000} value={maxHeight} onChange={event => setMaxHeight(event.target.valueAsNumber || 0)} className="min-w-0 w-full rounded-lg border border-border bg-surface p-2" /></label>
            </> : <label className="grid min-w-0 gap-1 text-sm">{t("direct.tape")}<select value={newTape} onChange={event => setNewTape(Number(event.target.value))} className="min-w-0 w-full rounded-lg border border-border bg-surface p-2">{[3.5,6,9,12,18,24].map(width => <option key={width} value={width}>{width} mm</option>)}</select></label>}
          </div>
          <Button
            className="ml-2"
            size="sm"
            disabled={creating || !newName.trim() || !queueName.trim() || (newKind === "system" && (maxWidth <= 0 || maxWidth > 1000 || maxHeight <= 0 || maxHeight > 1000))}
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
      {jobs.length ? (
        <details className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-xs font-medium text-muted">{t("shared.jobs")}</summary>
          <ul className="mt-2 space-y-2">
            {jobs.slice(0, 5).map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <span>
                  {t("shared.job", { count: job.count })} ·{" "}
                  {new Date(job.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {t(`shared.status.${job.status}`)}
                </span>
                {job.status === "queued" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void fetchJson("/api/v1/label-print-jobs", {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id: job.id }),
                      })
                        .then(() =>
                          setJobs((current) =>
                            current.map((j) =>
                              j.id === job.id
                                ? { ...j, status: "cancelled" }
                                : j,
                            ),
                          ),
                        )
                        .catch((e) => setError(String(e)));
                    }}
                  >
                    {t("shared.cancel")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">{t("shared.receiptHelp")}</p>
        </details>
      ) : null}
    </div>
  );
}
