import type { LabelTextElement, LabelTextRun } from "@/lib/label-setup-contract";
import { labelTargetUrl, type LabelResource } from "@/lib/label-target";

export const LABEL_TEXT_PLACEHOLDERS = [
  "Title", "Subtitle", "Identifier", "SKU", "Barcode", "Location", "Quantity", "Type", "ID", "URL",
] as const;
export type LabelTextPlaceholder = (typeof LABEL_TEXT_PLACEHOLDERS)[number];
export type LabelTextFormat = Omit<LabelTextRun, "text">;

export function labelTextDecoration(format: LabelTextFormat) {
  return [format.underline && "underline", format.strikethrough && "line-through"].filter(Boolean).join(" ") || "none";
}

export function normalizeLabelText(runs: LabelTextRun[]): LabelTextRun[] {
  const result: LabelTextRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const normalized: LabelTextRun = {
      text: run.text.replace(/\r\n?/g, "\n"),
      ...(run.weight !== undefined ? { weight: run.weight } : {}),
      ...(run.italic ? { italic: true } : {}),
      ...(run.underline ? { underline: true } : {}),
      ...(run.strikethrough ? { strikethrough: true } : {}),
    };
    const last = result.at(-1);
    if (last && last.weight === normalized.weight && last.italic === normalized.italic && last.underline === normalized.underline && last.strikethrough === normalized.strikethrough) {
      last.text += normalized.text;
    } else result.push(normalized);
  }
  return result;
}

function sliceText(runs: LabelTextRun[], start: number, end: number): LabelTextRun[] {
  let offset = 0;
  return runs.flatMap(run => {
    const from = Math.max(0, start - offset);
    const to = Math.min(run.text.length, end - offset);
    offset += run.text.length;
    return to > from ? [{ ...run, text: run.text.slice(from, to) }] : [];
  });
}

export function formatLabelText(runs: LabelTextRun[], start: number, end: number, format: LabelTextFormat): LabelTextRun[] {
  return normalizeLabelText([
    ...sliceText(runs, 0, start),
    ...sliceText(runs, start, end).map(run => ({ ...run, ...format })),
    ...sliceText(runs, end, Infinity),
  ]);
}

export function replaceLabelText(runs: LabelTextRun[], start: number, end: number, text: string, format: LabelTextFormat = {}): LabelTextRun[] {
  return normalizeLabelText([
    ...sliceText(runs, 0, start),
    { text, ...format },
    ...sliceText(runs, end, Infinity),
  ]);
}

export function defaultLabelTextContent(element: LabelTextElement): LabelTextRun[] {
  const placeholders = { name: "Title", subtitle: "Subtitle", identifier: "Identifier", url: "URL", location: "Location", text: "Title" };
  return element.content ?? [{ text: `[${placeholders[element.type]}]` }];
}

export function labelPlaceholderValues(resource: LabelResource, origin: string): Record<LabelTextPlaceholder, string> {
  return {
    Title: resource.name,
    Subtitle: resource.subtitle ?? "",
    Identifier: resource.stockUnit?.code ?? resource.sku ?? resource.id,
    SKU: resource.sku ?? "",
    Barcode: resource.barcode ?? "",
    Location: (resource.stockUnit ? resource.stockUnit.location : resource.location) ?? "",
    Quantity: String(resource.stockUnit ? 1 : resource.quantity),
    Type: resource.type,
    ID: resource.id,
    URL: labelTargetUrl(origin, resource),
  };
}

// Match against the complete template so formatting inside a placeholder does not
// break it. Resolve once: brackets in resource values always remain literal text.
export function resolveLabelText(runs: LabelTextRun[], values: Record<LabelTextPlaceholder, string>): LabelTextRun[] {
  const template = runs.map(run => run.text).join("");
  const result: LabelTextRun[] = [];
  let offset = 0;
  for (const match of template.matchAll(/\[([a-z]+)\]/gi)) {
    const placeholder = LABEL_TEXT_PLACEHOLDERS.find(key => key.toLowerCase() === match[1].toLowerCase());
    if (!placeholder) continue;
    result.push(...sliceText(runs, offset, match.index));
    const format = sliceText(runs, match.index, match.index + 1)[0];
    result.push({ ...format, text: values[placeholder] });
    offset = match.index + match[0].length;
  }
  result.push(...sliceText(runs, offset, Infinity));
  return normalizeLabelText(result);
}

export function labelUsesPlaceholder(elements: { visible: boolean; type: string; content?: LabelTextRun[] }[], placeholder: LabelTextPlaceholder): boolean {
  return elements.some(element => element.visible && (
    element.content
      ? element.content.map(run => run.text).join("").toLowerCase().includes(`[${placeholder.toLowerCase()}]`)
      : element.type === ({ Title: "name", Subtitle: "subtitle", Identifier: "identifier", URL: "url", Location: "location" } as Record<string, string>)[placeholder]
  ));
}
