import type { LabelFontFamily, LabelTextElement } from "./label-setup-contract";

export const LABEL_FONT_STACKS: Record<LabelFontFamily, string> = {
  sans: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  monospace: 'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
  "barlow-semi-condensed": '"Inventory Barlow Semi Condensed", sans-serif',
  inter: '"Inventory Inter", sans-serif',
  roboto: '"Inventory Roboto", sans-serif',
  "roboto-condensed": '"Inventory Roboto Condensed", sans-serif',
  "nunito-sans": '"Inventory Nunito Sans", sans-serif',
};
export const LABEL_NAMED_FONTS = [
  ["barlow-semi-condensed", "Barlow Semi Condensed"], ["inter", "Inter"],
  ["roboto", "Roboto"], ["roboto-condensed", "Roboto Condensed"], ["nunito-sans", "Nunito Sans"],
] as const;
export const LABEL_FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export const mmToPoints = (mm: number) => mm * 72 / 25.4;
export const pointsToMm = (pt: number) => pt * 25.4 / 72;
export function defaultLabelFontSize(element: LabelTextElement) {
  return element.type === "name" ? 3.8 : element.type === "url" ? 1.8 : 2.5;
}
export function defaultLabelFontWeight(element: LabelTextElement) {
  // Preserve the rendering of templates created before whole-element weights.
  if (element.fontWeight !== undefined) return element.fontWeight;
  if (element.content) return 400;
  if (element.fontFamily === "barlow-semi-condensed") return 700;
  return element.type === "name" ? 800 : element.type === "url" ? 500 : 650;
}
