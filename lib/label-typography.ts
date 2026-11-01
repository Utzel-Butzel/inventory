import type { LabelFontFamily, LabelTextElement } from "./label-setup-contract";
import { LABEL_FONT_FACES } from "@/lib/label-font-faces";

// Measure and render growing text at one font size, then scale geometrically.
export const LABEL_TEXT_PIXELS_PER_MM = 10;

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
  "source-sans-3": '"Inventory Source Sans 3", sans-serif',
  "source-serif-4": '"Inventory Source Serif 4", serif',
  "jetbrains-mono": '"Inventory JetBrains Mono", monospace',
  lora: '"Inventory Lora", serif',
  montserrat: '"Inventory Montserrat", sans-serif',
  "libre-franklin": '"Inventory Libre Franklin", sans-serif',
  bitter: '"Inventory Bitter", serif',
  alegreya: '"Inventory Alegreya", serif',
  "zilla-slab": '"Inventory Zilla Slab", serif',
};
export const LABEL_NAMED_FONTS = [
  ["barlow-semi-condensed", "Barlow Semi Condensed"], ["inter", "Inter"],
  ["roboto", "Roboto"], ["roboto-condensed", "Roboto Condensed"], ["nunito-sans", "Nunito Sans"],
  ["source-sans-3", "Source Sans 3"], ["source-serif-4", "Source Serif 4"],
  ["jetbrains-mono", "JetBrains Mono"], ["lora", "Lora"], ["montserrat", "Montserrat"],
  ["libre-franklin", "Libre Franklin"], ["bitter", "Bitter"], ["alegreya", "Alegreya"],
  ["zilla-slab", "Zilla Slab"],
] as const;
export const LABEL_FONT_CATEGORIES = ["sans", "serif", "slab", "monospace", "system"] as const;
export type LabelFontCategory = (typeof LABEL_FONT_CATEGORIES)[number];
export const LABEL_FONT_CATEGORY: Record<LabelFontFamily, LabelFontCategory> = {
  sans: "system", serif: "system", monospace: "system", rounded: "system",
  inter: "sans", roboto: "sans", "roboto-condensed": "sans", "nunito-sans": "sans",
  "barlow-semi-condensed": "sans", "source-sans-3": "sans", montserrat: "sans", "libre-franklin": "sans",
  "source-serif-4": "serif", lora: "serif", alegreya: "serif",
  bitter: "slab", "zilla-slab": "slab", "jetbrains-mono": "monospace",
};
export const LABEL_FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export function labelFontWeights(family?: LabelFontFamily) {
  const faces = family ? LABEL_FONT_FACES.filter(face => face.style === "normal" && LABEL_FONT_STACKS[family].startsWith(`"${face.family}"`)) : [];
  if (!faces.length) return LABEL_FONT_WEIGHTS;
  return LABEL_FONT_WEIGHTS.filter(weight => faces.some(face => {
    const [min, max = min] = face.weight.split(" ").map(Number);
    return weight >= min && weight <= max;
  }));
}
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
