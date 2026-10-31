"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "next-i18next/client";
import { Button } from "@/components/ui";
import { layoutLabelPages, type LabelSnapshot, type PrintMedia } from "@/lib/label-document";
import { downloadLabelPdf } from "@/lib/label-document-client";

export function LabelDocumentPreview({ labels, media, destination, onPrint, onClose }: {
  labels: LabelSnapshot[]; media: PrintMedia; destination: string;
  onPrint: () => Promise<void>; onClose: () => void;
}) {
  const { t } = useT("labels");
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [pageIndex, setPageIndex] = useState(0), [sent, setSent] = useState(false);
  const pages = layoutLabelPages(labels, media), page = pages[pageIndex];
  useEffect(() => { dialog.current?.showModal(); }, []);
  const run = async (action: () => Promise<void>, print: boolean) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await action(); if (print) setSent(true); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <dialog ref={dialog} className="m-auto max-h-[95dvh] w-[min(95vw,850px)] overflow-auto rounded-2xl border border-border bg-surface p-5 text-foreground shadow-xl backdrop:bg-black/40"
    aria-labelledby="print-document-title" onCancel={event => { event.preventDefault(); if (!lock.current) onClose(); }}>
    <h2 id="print-document-title" className="text-lg font-semibold">{t("paper.preview")}</h2>
    <p className="mt-1 text-sm text-muted">{destination} · {page.width} × {page.height} mm · {t("paper.page", { current: pageIndex + 1, total: pages.length })}</p>
    <div className="my-4 flex justify-center rounded-xl bg-surface-subtle p-4">
      <svg viewBox={`0 0 ${page.width} ${page.height}`} role="img" aria-label={t("paper.preview")} className="max-h-[55dvh] w-full" style={{ aspectRatio: `${page.width}/${page.height}` }}>
        <rect width={page.width} height={page.height} fill="white" />
        {page.labels.map(label => <image key={label.index} href={labels[label.index].png} x={label.x} y={label.y} width={label.width} height={label.height} />)}
      </svg>
    </div>
    {error ? <p role="alert" className="mb-3 text-sm text-danger">{error}</p> : null}
    {sent ? <p role="status" className="mb-3 text-sm text-brand">{t("paper.handedOff")}</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={busy || pageIndex === 0} onClick={() => setPageIndex(n => n - 1)}>{t("paper.previous")}</Button>
      <Button variant="secondary" disabled={busy || pageIndex === pages.length - 1} onClick={() => setPageIndex(n => n + 1)}>{t("paper.next")}</Button>
      <Button variant="secondary" disabled={busy} onClick={() => void run(() => downloadLabelPdf(labels, media), false)}>{t("paper.pdf")}</Button>
      <Button disabled={busy || sent} onClick={() => void run(onPrint, true)}>{t("paper.print")}</Button>
      <Button variant="secondary" disabled={busy} onClick={onClose}>{t("paper.close")}</Button>
    </div>
    <p className="mt-3 text-xs text-muted">{t("paper.previewHelp")}</p>
  </dialog>;
}
