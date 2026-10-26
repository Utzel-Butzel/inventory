import type { LabelElement } from "./label-setup-contract";

export function labelNudge(element: LabelElement, key: string, shift: boolean, widthMm: number, heightMm: number) {
  if (element.type === "background" || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return null;
  const step = shift ? 1 : 0.1;
  const clamp = (value: number, max: number) => Math.round(Math.max(0, Math.min(max, value)) * 10000) / 10000;
  return {
    x: clamp(element.x + (key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0) / widthMm * 100, 100 - element.width),
    y: clamp(element.y + (key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0) / heightMm * 100, 100 - element.height),
  };
}
