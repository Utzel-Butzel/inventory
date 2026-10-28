"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useT } from "next-i18next/client";
import { Bold, Italic, Underline, CornerDownLeft } from "lucide-react";

import { LABEL_FONT_WEIGHTS } from "@/lib/label-typography";
import { labelTextContentSchema, type LabelTextRun } from "@/lib/label-setup-contract";
import {
  LABEL_TEXT_PLACEHOLDERS, formatLabelText, normalizeLabelText, replaceLabelText,
  type LabelTextFormat, type LabelTextPlaceholder,
} from "@/lib/label-rich-text";

type TextSelection = { start: number; end: number };

function readEditor(root: HTMLElement): LabelTextRun[] {
  const runs: LabelTextRun[] = [];
  const visit = (node: Node, inherited: LabelTextFormat) => {
    if (node.nodeType === Node.TEXT_NODE) {
      runs.push({ text: node.textContent ?? "", ...inherited });
      return;
    }
    if (!(node instanceof HTMLElement) || node.dataset.textEnd) return;
    if (node.tagName === "BR") { runs.push({ text: "\n", ...inherited }); return; }
    const weight = Number(node.style.fontWeight);
    const format: LabelTextFormat = {
      ...inherited,
      ...(LABEL_FONT_WEIGHTS.some(value => value === weight) ? { weight } : {}),
      ...(node.style.fontStyle === "italic" ? { italic: true } : {}),
      ...(node.style.textDecorationLine === "underline" ? { underline: true } : {}),
    };
    node.childNodes.forEach(child => visit(child, format));
  };
  root.childNodes.forEach(node => visit(node, {}));
  return normalizeLabelText(runs);
}

function readSelection(root: HTMLElement): TextSelection | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  return { start, end: start + range.toString().length };
}

function restoreSelection(root: HTMLElement, selection: TextSelection) {
  const position = (offset: number): [Node, number] => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let last: Node | null = null;
    while ((node = walker.nextNode())) {
      const length = node.textContent?.length ?? 0;
      if (offset <= length) return [node, offset];
      offset -= length;
      last = node;
    }
    return last ? [last, last.textContent?.length ?? 0] : [root, 0];
  };
  const range = document.createRange();
  range.setStart(...position(selection.start));
  range.setEnd(...position(selection.end));
  root.focus();
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

function writeEditor(root: HTMLElement, runs: LabelTextRun[]) {
  const fragment = document.createDocumentFragment();
  for (const run of runs) {
    const span = document.createElement("span");
    span.textContent = run.text;
    if (run.weight) span.style.fontWeight = String(run.weight);
    if (run.italic) span.style.fontStyle = "italic";
    if (run.underline) span.style.textDecorationLine = "underline";
    fragment.append(span);
  }
  // Keep an empty last line reachable without adding a character to the value.
  if (!runs.length || runs.at(-1)?.text.endsWith("\n")) {
    const end = document.createElement("br");
    end.dataset.textEnd = "true";
    fragment.append(end);
  }
  root.replaceChildren(fragment);
}

export function LabelRichTextEditor({ value, onChange, placeholderValues }: {
  value: LabelTextRun[];
  onChange: (value: LabelTextRun[]) => void;
  placeholderValues: Record<LabelTextPlaceholder, string>;
}) {
  const { t } = useT("labels");
  const labelId = useId();
  const hintId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef(value);
  const publishedRef = useRef<string | null>(null);
  const selectionRef = useRef<TextSelection>({ start: 0, end: 0 });
  const formatRef = useRef<LabelTextFormat>({});
  const insertRef = useRef<(text: string) => void>(() => undefined);
  const composingRef = useRef(false);
  const [format, setFormat] = useState<LabelTextFormat>({});
  const [limitError, setLimitError] = useState(false);

  const rememberSelection = () => {
    const root = rootRef.current;
    const selection = root && readSelection(root);
    if (!selection) return;
    selectionRef.current = selection;
    let offset = 0;
    const run = valueRef.current.find(run => {
      offset += run.text.length;
      return offset > selection.start || (selection.start === selection.end && offset === selection.start);
    });
    const next = { weight: run?.weight, italic: run?.italic, underline: run?.underline };
    formatRef.current = next;
    setFormat(next);
  };

  const publish = (runs: LabelTextRun[], selection?: TextSelection) => {
    const root = rootRef.current;
    if (!root) return;
    if (!labelTextContentSchema.safeParse(runs).success) {
      setLimitError(true);
      writeEditor(root, valueRef.current);
      restoreSelection(root, selectionRef.current);
      return;
    }
    setLimitError(false);
    valueRef.current = runs;
    publishedRef.current = JSON.stringify(runs);
    if (selection) {
      writeEditor(root, runs);
      selectionRef.current = selection;
      restoreSelection(root, selection);
    }
    onChange(runs);
  };

  const insert = (text: string) => {
    const selection = (rootRef.current && readSelection(rootRef.current)) ?? selectionRef.current;
    const normalized = text.replace(/\r\n?/g, "\n");
    publish(replaceLabelText(valueRef.current, selection.start, selection.end, normalized, formatRef.current), {
      start: selection.start + normalized.length, end: selection.start + normalized.length,
    });
  };

  const applyFormat = (patch: LabelTextFormat) => {
    const selection = (rootRef.current && readSelection(rootRef.current)) ?? selectionRef.current;
    formatRef.current = { ...formatRef.current, ...patch };
    setFormat(formatRef.current);
    if (selection.start !== selection.end) {
      publish(formatLabelText(valueRef.current, selection.start, selection.end, patch), selection);
    } else if (rootRef.current) restoreSelection(rootRef.current, selection);
  };

  useLayoutEffect(() => {
    insertRef.current = insert;
  });

  useLayoutEffect(() => {
    const serialized = JSON.stringify(value);
    valueRef.current = value;
    if (serialized === publishedRef.current || !rootRef.current) return;
    const root = rootRef.current;
    const focused = document.activeElement === root;
    writeEditor(root, value);
    publishedRef.current = serialized;
    if (focused) restoreSelection(root, selectionRef.current);
  }, [value]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Use the native event to cover mobile keyboards as well as physical Enter.
    const beforeInput = (event: InputEvent) => {
      if (event.isComposing || composingRef.current || !event.cancelable) return;
      if (event.inputType === "insertText" && event.data !== null) {
        event.preventDefault();
        insertRef.current(event.data);
      } else if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
        event.preventDefault();
        insertRef.current("\n");
      }
    };
    root.addEventListener("beforeinput", beforeInput);
    return () => root.removeEventListener("beforeinput", beforeInput);
  }, []);

  const buttonClass = (active: boolean) => `grid h-8 min-w-8 place-items-center rounded-lg px-2 text-xs ${active ? "bg-brand-soft text-brand" : "text-muted-strong hover:bg-surface-hover"}`;
  return (
    <div className="mt-4">
      <p id={labelId} className="text-[12px] font-semibold text-muted">{t("designer.richText.content")}</p>
      <div className="mt-1.5 rounded-xl border border-border bg-surface">
        <div role="group" aria-label={t("designer.richText.formatting")} className="flex flex-wrap gap-0.5 border-b border-border p-1">
          <button type="button" title={`${t("designer.richText.bold")} (⌘/Ctrl+B)`} aria-label={t("designer.richText.bold")} aria-pressed={format.weight === 700} className={buttonClass(format.weight === 700)} onMouseDown={event => event.preventDefault()} onClick={() => applyFormat({ weight: formatRef.current.weight === 700 ? 400 : 700 })}><Bold size={15} /></button>
          <select aria-label={t("designer.selectionWeight")} value={format.weight ?? ""} className="h-8 max-w-28 rounded-lg bg-surface px-1 text-xs" onChange={event => applyFormat({ weight: event.target.value ? Number(event.target.value) : undefined })}>
            <option value="">{t("designer.inheritWeight")}</option>
            {LABEL_FONT_WEIGHTS.map(weight => <option key={weight} value={weight}>{weight} · {t(`designer.weights.${weight}`)}</option>)}
          </select>
          <button type="button" title={`${t("designer.richText.italic")} (⌘/Ctrl+I)`} aria-label={t("designer.richText.italic")} aria-pressed={Boolean(format.italic)} className={buttonClass(Boolean(format.italic))} onMouseDown={event => event.preventDefault()} onClick={() => applyFormat({ italic: !formatRef.current.italic })}><Italic size={15} /></button>
          <button type="button" title={`${t("designer.richText.underline")} (⌘/Ctrl+U)`} aria-label={t("designer.richText.underline")} aria-pressed={Boolean(format.underline)} className={buttonClass(Boolean(format.underline))} onMouseDown={event => event.preventDefault()} onClick={() => applyFormat({ underline: !formatRef.current.underline })}><Underline size={15} /></button>
          <button type="button" title={t("designer.richText.lineBreak")} aria-label={t("designer.richText.lineBreak")} className={buttonClass(false)} onMouseDown={event => event.preventDefault()} onClick={() => insert("\n")}><CornerDownLeft size={15} /></button>
        </div>
        <div
          ref={rootRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          tabIndex={0}
          aria-multiline="true"
          aria-labelledby={labelId}
          aria-describedby={hintId}
          spellCheck={false}
          className="min-h-28 max-h-64 overflow-y-auto whitespace-pre-wrap break-words p-3 text-sm font-normal leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-inset focus:ring-focus/40"
          onInput={() => { if (rootRef.current) publish(readEditor(rootRef.current)); }}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; if (rootRef.current) publish(readEditor(rootRef.current)); rememberSelection(); }}
          onMouseUp={rememberSelection}
          onKeyUp={event => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) rememberSelection(); }}
          onBlur={rememberSelection}
          onPaste={event => { event.preventDefault(); insert(event.clipboardData.getData("text/plain")); }}
          onDrop={event => event.preventDefault()}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") { event.preventDefault(); insert("\n"); return; }
            if (!(event.metaKey || event.ctrlKey)) return;
            const key = event.key.toLowerCase();
            if (!["b", "i", "u"].includes(key)) return;
            event.preventDefault();
            event.stopPropagation();
            applyFormat(key === "b" ? { weight: formatRef.current.weight === 700 ? 400 : 700 } : key === "i" ? { italic: !formatRef.current.italic } : { underline: !formatRef.current.underline });
          }}
        />
      </div>
      <label className="mt-2 block text-[12px] font-semibold text-muted">
        {t("designer.richText.insertPlaceholder")}
        <select value="" onChange={event => { if (event.target.value) insert(`[${event.target.value}]`); }} className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs text-foreground">
          <option value="">{t("designer.richText.choosePlaceholder")}</option>
          {LABEL_TEXT_PLACEHOLDERS.map(key => <option key={key} value={key}>{t("designer.richText.placeholderExample", {
            name: t(`designer.richText.placeholders.${key}`),
            example: placeholderValues[key] || t(`designer.richText.examples.${key}`),
          })}</option>)}
        </select>
      </label>
      <p id={hintId} className="mt-2 text-[11px] leading-4 text-muted">{t("designer.richText.hint")}</p>
      {limitError ? <p role="alert" className="mt-2 text-xs text-danger">{t("designer.richText.limit")}</p> : null}
    </div>
  );
}
