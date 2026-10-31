"use client";
import { useT } from "next-i18next/client";
import { DEFAULT_PRINT_MEDIA, printMediaSchema, type PrintMedia } from "@/lib/label-document";
import { Button } from "@/components/ui";

export function LabelPrintMedia({ value, onChange, disabled, onTest }: {
  value: PrintMedia; onChange: (value: PrintMedia) => void; disabled: boolean; onTest: () => void;
}) {
  const { t } = useT("labels");
  const valid = printMediaSchema.safeParse(value).success;
  const field = (key: keyof PrintMedia, min = 0, max = 1000, step = 0.1) => <label key={key} className="grid min-w-0 gap-1 text-xs">
    {t(`paper.${key}`)}<input type="number" min={min} max={max} step={step} value={value[key]} disabled={disabled}
      className="w-full rounded-lg border border-border bg-surface p-2"
      onChange={event => onChange({ ...value, [key]: event.target.valueAsNumber || 0 })} />
  </label>;
  return <details className="mt-3 rounded-xl border border-border p-3" open>
    <summary className="cursor-pointer text-sm font-medium">{t("paper.title")}</summary>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <label className="text-sm">{t("paper.mode")} <select value={value.mode} disabled={disabled} className="rounded-lg border border-border bg-surface p-2"
        onChange={event => onChange({ ...value, mode: event.target.value as PrintMedia["mode"], offsetXMm: 0, offsetYMm: 0 })}>
        <option value="individual">{t("paper.individual")}</option><option value="sheet">{t("paper.sheet")}</option>
      </select></label>
      {value.mode === "sheet" ? <label className="text-sm">{t("paper.preset")} <select aria-label={t("paper.preset")} value="" disabled={disabled} className="rounded-lg border border-border bg-surface p-2"
        onChange={event => {
          if (event.target.value === "a4") onChange({ ...DEFAULT_PRINT_MEDIA, mode: "sheet" });
          if (event.target.value === "letter") onChange({ ...DEFAULT_PRINT_MEDIA, mode: "sheet", pageWidthMm: 215.9, pageHeightMm: 279.4, columns: 3, rows: 10, cellWidthMm: 66.675, cellHeightMm: 25.4, marginLeftMm: 4.7625, marginTopMm: 12.7, gapXMm: 3.175 });
        }}><option value="">{t("paper.custom")}</option><option value="a4">A4 · 3 × 8 · 63.5 × 33.9 mm</option><option value="letter">Letter · 3 × 10 · 66.675 × 25.4 mm</option></select></label> : null}
      <Button variant="secondary" size="sm" disabled={disabled || !valid} onClick={onTest}>{t("paper.test")}</Button>
    </div>
    {value.mode === "sheet" ? <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {field("pageWidthMm", 1)}{field("pageHeightMm", 1)}{field("columns", 1, 30, 1)}{field("rows", 1, 100, 1)}
      {field("cellWidthMm", 1)}{field("cellHeightMm", 1)}{field("startPosition", 1, value.columns * value.rows, 1)}
      {field("marginLeftMm", 0, 500)}{field("marginTopMm", 0, 500)}{field("gapXMm", 0, 100)}{field("gapYMm", 0, 100)}
      {field("offsetXMm", -50, 50)}{field("offsetYMm", -50, 50)}
    </div> : null}
    {!valid ? <p role="alert" className="mt-2 text-sm text-danger">{t("paper.invalid")}</p> : null}
    <p className="mt-2 text-xs leading-5 text-muted">{t("paper.help")}</p>
  </details>;
}
