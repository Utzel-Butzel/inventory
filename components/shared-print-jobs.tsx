"use client";
import { LabelHelp } from "@/components/label-help";
import { useEffect, useState } from "react";
import { useT } from "next-i18next/client";
import { fetchJson } from "@/lib/client-types";
import type { SharedPrintJob } from "@/lib/shared-label-print-contract";
import { Button } from "@/components/ui";

export function SharedPrintJobs() {
  const { t } = useT("labels");
  const [jobs, setJobs] = useState<SharedPrintJob[]>([]);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [cancelling, setCancelling] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const result = await fetchJson<{ jobs: SharedPrintJob[] }>("/api/v1/label-print-jobs", { cache: "no-store", signal: controller.signal });
        setJobs(result.jobs);
        setLoadError("");
      } catch (error) { if (!controller.signal.aborted) setLoadError(String(error)); }
      finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    window.addEventListener("inventory:print-jobs", refresh);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("inventory:print-jobs", refresh); };
  }, [refreshKey]);
  const cancelJob = async (id: string) => {
    setCancelling(id); setError("");
    try {
      const result = await fetchJson<{ job: SharedPrintJob }>("/api/v1/label-print-jobs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      setJobs(current => current.map(job => job.id === id ? { ...result.job, printerName: job.printerName } : job));
      setRefreshKey(key => key + 1);
    } catch (error) { setError(String(error)); setRefreshKey(key => key + 1); }
    finally { setCancelling(null); }
  };
  return <div className="mb-5">
    {error || loadError ? <p role="alert" className="mb-2 text-sm text-warning">{error || loadError}</p> : null}
      {jobs.length ? (
        <section className="rounded-xl border border-border p-3" aria-label={t("shared.jobs")}>
          <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{t("shared.jobs")}</h3><LabelHelp><p>{t("shared.cancelHelp")}</p><p className="mt-2">{t("shared.receiptHelp")}</p></LabelHelp></div>
          <ul className="mt-2 max-h-80 space-y-3 overflow-y-auto">
            {jobs.map(job => <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-xs">
              <div>
                <p className="font-medium">{job.printerName ?? t("shared.printer")} · {t("shared.job", { count: job.count })}</p>
                <p className="mt-1">{new Date(job.createdAt).toLocaleString()} · {job.cancelRequestedAt && !job.cancelResult ? t("shared.cancelRequested") : t(`shared.status.${job.status}`)}</p>
                {job.cancelResult ? <p className="mt-1 text-muted">{t(`shared.cancelResult.${job.cancelResult}`)}</p> : null}
                {!job.canCancel && !job.cancelRequestedAt && job.status === "claimed" ? <p className="mt-1 text-muted">{t("shared.legacyCancelHelp")}</p> : null}
              </div>
              {job.canCancel ? <Button size="sm" variant="secondary" disabled={cancelling === job.id} onClick={() => void cancelJob(job.id)}>{t(cancelling === job.id ? "shared.cancelling" : "shared.cancel")}</Button> : null}
            </li>)}
          </ul>

        </section>
      ) : null}
  </div>;
}
