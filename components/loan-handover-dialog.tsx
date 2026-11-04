"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "next-i18next/client";
import { Camera, FileText, LoaderCircle, Plus, X } from "lucide-react";
import { Button } from "@/components/ui";
import { fetchJson } from "@/lib/client-types";
import { loanHandoverSchema, type LoanHandoverInput, type LoanHandoverDocument, handoverConditions } from "@/lib/loan-handover-contract";
import { handoverLabels } from "@/lib/loan-handover-labels";

const inputClass = "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground";

function Dialog({ title, busy, onClose, children }: { title: string; busy?: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); dialog?.focus({ preventScroll: true }); if (dialog) dialog.scrollTop = 0; return () => dialog?.close(); }, []);
  return <dialog ref={ref} tabIndex={-1} aria-label={title} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[min(44rem,calc(100%-2rem))] overflow-y-auto rounded-2xl border border-border bg-surface p-5 text-foreground shadow-2xl backdrop:bg-black/50 sm:p-7">
    <h2 className="mb-4 text-xl font-semibold">{title}</h2>{children}
  </dialog>;
}

function Report({ document, locale }: { document: LoanHandoverDocument; locale: string }) {
  const l = handoverLabels(locale);
  return <article className="space-y-3 rounded-xl border border-border p-4 text-sm">
    <h3 className="font-semibold">{l[document.phase]} · {new Date(document.occurredAt).toLocaleString(locale)}</h3>
    <p>{document.resourceName} · {document.unitCode ?? `${l.quantity}: ${document.quantity}`}</p>
    <p>{l.borrower}: {document.borrower}</p>
    <p>{l.condition}: <strong>{l[document.condition]}</strong></p>
    {document.notes && <p className="whitespace-pre-wrap">{document.notes}</p>}
    <ul className="space-y-1">{document.accessories.map((item) => <li key={item.name}>{item.present ? l.present : l.missing}: {item.name}</li>)}</ul>
    {document.photos.length > 0 && <div className="grid grid-cols-2 gap-2">{document.photos.map((photo, i) =>
      // Immutable, authenticated report images are embedded rather than fetched from the item gallery.
      // eslint-disable-next-line @next/next/no-img-element
      <a key={i} href={photo} download={`handover-${document.phase}-${i + 1}.jpg`}><img src={photo} alt={`${l.photos} ${i + 1}`} className="aspect-[4/3] w-full rounded-lg object-contain" /></a>)}</div>}
    <p>{l.givenBy}: {document.givenBy}<br />{l.receivedBy}: {document.receivedBy}</p>
    <p>{l.confirmation}</p>
    <p className="text-xs text-muted">{l.confirmationHelp}</p>
    <p className="text-xs text-muted">{l.recorded}: {new Date(document.recordedAt).toLocaleString(locale)} · {l.actor}: {document.recordedBy}</p>
  </article>;
}

export function LoanHandoverDialog({ phase, assignmentId, reportsUrl, borrower, itemName, onClose, onConfirm }: {
  phase: "checkout" | "return"; assignmentId?: string; reportsUrl?: string; borrower: string; itemName: string;
  onClose: () => void; onConfirm: (handover: LoanHandoverInput) => Promise<void>;
}) {
  const { i18n } = useT("loans");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const l = handoverLabels(locale);
  const [condition, setCondition] = useState<LoanHandoverInput["condition"]>("good");
  const [notes, setNotes] = useState("");
  const [accessories, setAccessories] = useState<LoanHandoverInput["accessories"]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [givenBy, setGivenBy] = useState(phase === "return" ? borrower : "");
  const [receivedBy, setReceivedBy] = useState(phase === "checkout" ? borrower : "");
  const [confirmed, setConfirmed] = useState(false);
  const [originals, setOriginals] = useState<LoanHandoverDocument[]>([]);
  const reportEndpoint = reportsUrl ?? (assignmentId ? `/api/v1/assignments/${assignmentId}/handovers` : null);
  const [loading, setLoading] = useState(phase === "return" && Boolean(reportEndpoint));
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (phase !== "return" || !reportEndpoint) return;
    const controller = new AbortController();
    void fetchJson<{ documents: LoanHandoverDocument[] }>(reportEndpoint, { signal: controller.signal, cache: "no-store" })
      .then(({ documents }) => {
        const checkouts = documents.filter((document) => document.phase === "checkout");
        setOriginals(checkouts);
        // Require an explicit new check; do not copy prior confirmations or photos.
        const names = new Map(checkouts.flatMap((document) => document.accessories).map((item) => [item.name.toLocaleLowerCase("en"), item.name]));
        setAccessories([...names.values()].map((name) => ({ name, present: false })));
      }).catch(() => { if (!controller.signal.aborted) setLoadFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reportEndpoint, phase]);
  const lockedNames = new Set(originals.flatMap((document) => document.accessories).map((item) => item.name));
  async function addPhotos(files: File[]) {
    setError(null);
    if (files.length + photos.length > 4 || files.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 20_000_000)) {
      setError(l.photoError); return;
    }
    setProcessing(true);
    try {
      const { default: compress } = await import("browser-image-compression");
      const added: string[] = [];
      for (const file of files) {
        const compressed = await compress(file, { maxSizeMB: 0.75, maxWidthOrHeight: 1600, fileType: "image/jpeg", useWebWorker: true });
        added.push(await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(compressed);
        }));
      }
      setPhotos((current) => [...current, ...added]);
    } catch { setError(l.photoError); }
    finally { setProcessing(false); }
  }
  return <Dialog title={l[phase]} busy={busy || processing} onClose={onClose}>
    <p className="mb-2 font-medium">{itemName} · {borrower}</p>
    <p className="mb-4 text-sm text-muted">{l.description}</p>
    {loading ? <p role="status">{l.loading}</p> : loadFailed ? <p role="alert" className="text-danger">{l.loadError}</p> : null}
    {originals.length > 0 && <details className="mb-4"><summary className="cursor-pointer text-sm font-semibold text-brand">{l.original}</summary><div className="mt-2">{originals.map((document, index) => <Report key={document.movementId ?? index} document={document} locale={locale} />)}</div></details>}
    <form onSubmit={async (event) => {
      event.preventDefault();
      const parsed = loanHandoverSchema.safeParse({ condition, notes, accessories, photos, givenBy, receivedBy, confirmed });
      if (!parsed.success) { setError((condition === "damaged" || accessories.some((item) => !item.present)) && !notes.trim() ? l.notesRequired : parsed.error.issues[0].message); return; }
      setBusy(true); setError(null);
      try { await onConfirm(parsed.data); onClose(); }
      catch (failure) { setError(failure instanceof Error ? failure.message : l.error); }
      finally { setBusy(false); }
    }} className="space-y-4">
      <fieldset disabled={busy || processing || loading || loadFailed} className="space-y-4">
        <label className="block text-sm font-medium">{l.condition}<select className={inputClass} value={condition} onChange={(event) => setCondition(event.target.value as typeof condition)}>{handoverConditions.map((value) => <option key={value} value={value}>{l[value]}</option>)}</select></label>
        <label className="block text-sm font-medium">{l.notes}<textarea className={inputClass} rows={3} maxLength={4000} required={condition === "damaged" || accessories.some((item) => !item.present)} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <div className="space-y-2"><h3 className="text-sm font-medium">{l.accessories}</h3>
          {accessories.map((item, index) => <div key={index} className="flex items-center gap-2">
            <input aria-label={`${l.accessoryName} ${index + 1}`} className={inputClass} required maxLength={160} readOnly={lockedNames.has(item.name)} value={item.name} onChange={(event) => setAccessories((items) => items.map((value, i) => i === index ? { ...value, name: event.target.value } : value))} />
            <label className="flex shrink-0 items-center gap-1 text-xs"><input type="checkbox" checked={item.present} onChange={(event) => setAccessories((items) => items.map((value, i) => i === index ? { ...value, present: event.target.checked } : value))} />{l.present}</label>
            {!lockedNames.has(item.name) && <Button type="button" variant="ghost" size="sm" aria-label={`${l.remove}: ${item.name || index + 1}`} onClick={() => setAccessories((items) => items.filter((_, i) => i !== index))}><X className="size-4" /></Button>}
          </div>)}
          <Button type="button" variant="secondary" size="sm" disabled={accessories.length >= 30} onClick={() => setAccessories((items) => [...items, { name: "", present: true }])}><Plus className="size-4" />{l.addAccessory}</Button>
        </div>
        <div><label className="block text-sm font-medium"><span className="flex items-center gap-2"><Camera className="size-4" />{l.photos}</span><input className="mt-2 block w-full text-sm" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={photos.length >= 4} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void addPhotos(files); }} /></label><p className="mt-1 text-xs text-muted">{l.photoHelp}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">{photos.map((photo, i) => <div key={i} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt={`${l.photos} ${i + 1}`} className="aspect-[4/3] w-full rounded-lg object-contain" />
            <Button className="absolute right-1 top-1" variant="secondary" size="sm" type="button" aria-label={`${l.remove}: ${l.photos} ${i + 1}`} onClick={() => setPhotos((items) => items.filter((_, index) => index !== i))}><X className="size-4" /></Button>
          </div>)}</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">{l.givenBy}<input required maxLength={240} className={inputClass} value={givenBy} onChange={(event) => setGivenBy(event.target.value)} /></label>
          <label className="text-sm font-medium">{l.receivedBy}<input required maxLength={240} className={inputClass} value={receivedBy} onChange={(event) => setReceivedBy(event.target.value)} /></label>
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" /><span>{l.confirmation}</span></label>
        <p className="text-xs text-muted">{l.confirmationHelp}</p>
        {phase === "return" && <p className="text-xs text-muted">{l.stockHelp}</p>}
      </fieldset>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="secondary" disabled={busy || processing} onClick={onClose}>{l.cancel}</Button><Button type="submit" disabled={busy || processing || loading || loadFailed || !confirmed}>{busy || processing ? <LoaderCircle className="size-4 animate-spin" /> : null}{busy ? l.saving : l.save}</Button></div>
    </form>
  </Dialog>;
}

export function LoanHandoverReports({ assignmentId, reportsUrl }: { assignmentId: string; reportsUrl?: string }) {
  const { i18n } = useT("loans");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const l = handoverLabels(locale);
  const reportEndpoint = reportsUrl ?? `/api/v1/assignments/${assignmentId}/handovers`;
  const [open, setOpen] = useState(false);
  const [documents, setDocuments] = useState<LoanHandoverDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetchJson<{ documents: LoanHandoverDocument[] }>(reportEndpoint, { signal: controller.signal, cache: "no-store" })
      .then((result) => setDocuments(result.documents)).catch(() => { if (!controller.signal.aborted) setError(l.loadError); });
    return () => controller.abort();
  }, [reportEndpoint, open, l.loadError]);
  return <><Button variant="ghost" size="sm" onClick={() => { setDocuments(null); setError(null); setOpen(true); }}><FileText className="size-4" />{l.view}</Button>
    {open && <Dialog title={l.reports} busy={downloading} onClose={() => setOpen(false)}>
      <div className="space-y-4">{documents ? documents.length ? documents.map((document) => <Report key={document.movementId ?? document.phase} document={document} locale={locale} />) : <p>{l.noReport}</p> : !error && <p>{l.loading}</p>}</div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" disabled={downloading} onClick={() => setOpen(false)}>{l.close}</Button>
        {!!documents?.length && <Button disabled={downloading} onClick={async () => {
          setDownloading(true);
          try {
            const response = await fetch(`${reportEndpoint}${reportEndpoint.includes("?") ? "&" : "?"}format=pdf&locale=${encodeURIComponent(locale)}`, { cache: "no-store" });
            if (!response.ok) throw new Error(l.loadError);
            const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `handover-${assignmentId}.pdf`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch { setError(l.loadError); }
          finally { setDownloading(false); }
        }}>{l.pdf}</Button>}
      </div>
    </Dialog>}
  </>;
}
