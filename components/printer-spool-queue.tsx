"use client";
import { LabelHelp } from "@/components/label-help";
import { useEffect, useState } from "react";
import { useT } from "next-i18next/client";
import { Button } from "@/components/ui";
import { fetchJson } from "@/lib/client-types";
import { connectQz } from "@/lib/qz-label-printer";
import type { SpoolSnapshot } from "@/lib/spool-queue-contract";

type QueueState = { snapshot: SpoolSnapshot | null; fresh: boolean; checkedAt: string | null; commands: { id: string; status: string; action?: string }[] };
let listenerWork: Promise<unknown> = Promise.resolve();
function serializeListener(work: () => Promise<unknown>) {
  const next = listenerWork.catch(() => {}).then(work);
  listenerWork = next;
  return next;
}
export function PrinterSpoolQueue({ remoteId, name }: { remoteId?: string; name: string }) {
  const { t } = useT("labels");
  const [state, setState] = useState<QueueState | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [watch, setWatch] = useState(false);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<{ id: number; title: string; status: string }[]>([]);
  const [confirmation, setConfirmation] = useState<{ refs?: string[]; jobId?: number; action?: "pause" | "resume" | "restart" | "repair" } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!remoteId) return;
    const controller = new AbortController();
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const result = await fetchJson<QueueState>(`/api/v1/label-printers/spool?printerId=${encodeURIComponent(remoteId)}`, { signal: controller.signal, cache: "no-store" });
        if (!controller.signal.aborted) { setState(result); setError(""); }
      } catch (e) { if (!controller.signal.aborted) { setError(String(e)); setState(null); } }
      finally { loading = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [remoteId]);
  useEffect(() => {
    if (remoteId || !watch) return;
    let disposed = false;
    let active = false;
    let session: Awaited<ReturnType<typeof connectQz>> | undefined;
    let polling = false;
    void serializeListener(async () => {
      const qz = await connectQz();
      if (disposed) return;
      session = qz;
      qz.printers.setPrinterCallbacks(data => {
        if (disposed || typeof data !== "object" || data === null) return;
        const event = data as Record<string, unknown>;
        const id = Number(event.jobId);
        if (event.printerName !== name || event.eventType !== "JOB" || !Number.isSafeInteger(id) || id <= 0) return;
        setEvents(old => [{ id, title: String(event.jobName ?? ""), status: String(event.statusText ?? event.statusCode ?? "") }, ...old.filter(row => row.id !== id)].slice(0, 200));
      });
      await qz.printers.startListening(name);
      active = true;
      await qz.printers.getStatus();
      if (!disposed) setConnected(true);
    }).catch(e => { if (!disposed) { setError(String(e)); setWatch(false); setConnected(false); } });
    const timer = window.setInterval(() => {
      if (!active || !session || polling) return;
      if (!session.websocket.isActive()) { setConnected(false); setWatch(false); setEvents([]); return; }
      polling = true;
      void session.printers.getStatus().catch(e => { if (!disposed) { setConnected(false); setWatch(false); setEvents([]); setError(String(e)); } }).finally(() => { polling = false; });
    }, 5000);
    return () => {
      disposed = true; window.clearInterval(timer);
      void serializeListener(async () => { if (session) { if (active && session.websocket.isActive()) await session.printers.stopListening(); session.printers.setPrinterCallbacks([]); } }).catch(() => {});
    };
  }, [name, remoteId, watch]);
  const pending = state?.commands.some(command => ["queued", "claimed"].includes(command.status));
  const available = remoteId ? state?.fresh && state.snapshot?.supported && !pending : connected;
  const cancel = async () => {
    if (!confirmation || !available) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (remoteId) {
        const command = await fetchJson<{ id: string; status: string }>("/api/v1/label-printers/spool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ printerId: remoteId, refs: confirmation.refs, action: confirmation.action ?? "cancel" }) });
        setState(old => old ? { ...old, commands: [command, ...old.commands] } : old);
      } else {
        const qz = await connectQz();
        await qz.printers.clearQueue({ printerName: name, ...(confirmation.jobId ? { jobId: confirmation.jobId } : {}) });
        setMessage(t("spool.sent"));
        await qz.printers.getStatus();
      }
      setConfirmation(null);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return <section className="mb-5 rounded-xl border border-border p-3">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{t("spool.title")}</h3><LabelHelp>{t(remoteId ? "spool.remoteHelp" : "spool.qzHelp")}</LabelHelp></div>
    <p className="mt-1 text-sm">{t(remoteId ? "spool.remote" : "spool.local", { name })}</p>

    {remoteId ? <p className="mt-2 text-xs">{t(!state?.fresh ? "spool.stale" : !state.snapshot?.supported ? "spool.unavailable" : "spool.current")}{state?.checkedAt ? ` · ${new Date(state.checkedAt).toLocaleTimeString()}` : ""}{state?.fresh && !state.snapshot?.supported ? <LabelHelp>{t("spool.unsupported")}</LabelHelp> : null}</p> : !watch ? <Button size="sm" variant="secondary" onClick={() => setWatch(true)}>{t("spool.connect")}</Button> : <p className="mt-2 text-xs">{t(connected ? "spool.listening" : "spool.connecting")}</p>}
    {error ? <p role="alert" className="mt-2 text-sm text-warning">{error}</p> : null}
    {message ? <p role="status" className="mt-2 text-sm">{message}</p> : null}
    <ul className="mt-2 max-h-80 overflow-y-auto">
      {remoteId ? state?.snapshot?.jobs.map(job => <li key={job.ref} className="flex items-center justify-between gap-3 border-b border-border py-2 text-xs"><span>#{job.id} · {job.title || t("spool.untitled")} · {job.owner} · {job.state}</span><div className="flex flex-wrap gap-2">{(["pause", "resume", "restart"] as const).filter(action => state.snapshot?.actions?.includes(action) && !/Complete|Printed|Deleting/i.test(job.state) && (action === "pause" ? !/Paused/i.test(job.state) : action === "resume" ? /Paused/i.test(job.state) : /Error|Offline|Blocked|Retained/i.test(job.state))).map(action => <Button key={action} size="sm" variant="secondary" disabled={!available || busy} onClick={() => setConfirmation({ refs: [job.ref], action })}>{t(`spool.actions.${action}`)}</Button>)}<Button size="sm" variant="secondary" disabled={!available || busy} onClick={() => setConfirmation({ refs: [job.ref] })}>{t("shared.cancel")}</Button></div></li>) : events.map(job => <li key={job.id} className="flex items-center justify-between gap-3 border-b border-border py-2 text-xs"><span>#{job.id} · {job.title || t("spool.untitled")} · {job.status}</span><Button size="sm" variant="secondary" disabled={!available || busy || ["COMPLETE", "DELETED", "DELETING", "CANCELED", "ABORTED", "SENT"].includes(job.status)} onClick={() => setConfirmation({ jobId: job.id })}>{t("shared.cancel")}</Button></li>)}
    </ul>
    {remoteId && available && !state?.snapshot?.jobs.length ? <p className="mt-2 text-xs">{t("spool.empty")}</p> : null}
    {remoteId && state?.snapshot?.actions?.includes("repair") ? <Button className="mt-3 mr-2" size="sm" variant="secondary" disabled={!available || busy} onClick={() => setConfirmation({ refs: [], action: "repair" })}>{t("spool.actions.repair")}</Button> : null}
    <Button className="mt-3" size="sm" variant="secondary" disabled={!available || busy || (!!remoteId && !state?.snapshot?.jobs.length)} onClick={() => setConfirmation(remoteId ? { refs: state?.snapshot?.jobs.map(job => job.ref) } : {})}>{t(remoteId ? "spool.clearShown" : "spool.clear")}</Button>
    {confirmation ? <div role="alertdialog" aria-label={t(confirmation?.action ? `spool.actions.${confirmation.action}` : "spool.confirmTitle")} className="mt-3 rounded-lg border border-warning p-3 text-sm"><p className="font-medium">{t(confirmation?.action ? `spool.actions.${confirmation.action}` : "spool.confirmTitle")} · {name}</p><p className="mt-2">{t(confirmation.action ? `spool.help.${confirmation.action}` : "spool.confirmHelp")}</p><p className="mt-1">{confirmation.refs ? t("spool.count", { count: confirmation.refs.length }) : confirmation.jobId ? `#${confirmation.jobId}` : t("spool.all")}</p><div className="mt-3 flex gap-2"><Button size="sm" disabled={!available || busy} onClick={() => void cancel()}>{t(confirmation.action ? `spool.actions.${confirmation.action}` : "spool.confirm")}</Button><Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>{t("spool.back")}</Button></div></div> : null}
    {state?.commands.slice(0, 3).map(command => <p key={command.id} role="status" className="mt-2 text-xs">{command.action && command.action !== "cancel" ? `${t(`spool.actions.${command.action}`)}: ` : ""}{t(`spool.command.${command.status}`)}</p>)}
  </section>;
}
