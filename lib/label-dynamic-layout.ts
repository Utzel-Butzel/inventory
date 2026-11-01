import { labelElementKey, type LabelElement, type LabelSetupDto, type LabelTextElement } from "@/lib/label-setup-contract";

export function automaticLabelText(elements: LabelElement[]): LabelTextElement | undefined {
  return elements.find((element): element is LabelTextElement => element.visible && "autoWidth" in element && element.autoWidth === true);
}

/** Grow the text and translate everything to its right without scaling QR codes or images. */
export function resolveLabelLayout(setup: LabelSetupDto, textWidthMm: number): LabelSetupDto {
  const text = automaticLabelText(setup.elements);
  if (!text || !Number.isFinite(textWidthMm) || textWidthMm < 0) return setup;
  const oldTextWidth = text.width / 100 * setup.widthMm;
  const textRight = text.x + text.width;
  let delta = Math.max(0.1, textWidthMm) - oldTextWidth;
  // Do not introduce collisions with content on another row or in an overlapping box.
  const fixed = setup.elements.filter(element => element.visible && element.type !== "background" && element !== text && element.x < textRight - 0.000001);
  const moving = setup.elements.filter(element => element.visible && element.type !== "background" && element !== text && element.x >= textRight - 0.000001);
  for (const left of fixed) for (const right of moving) {
    if (left.y < right.y + right.height && left.y + left.height > right.y && left.x + left.width <= right.x) {
      delta = Math.max(delta, (left.x + left.width - right.x) / 100 * setup.widthMm);
    }
  }
  const boxes = setup.elements.map(element => {
    const isText = labelElementKey(element) === labelElementKey(text);
    const shifts = !isText && element.x >= textRight - 0.000001;
    return {
      element,
      x: element.x / 100 * setup.widthMm + (shifts ? delta : 0),
      width: isText ? oldTextWidth + delta : element.width / 100 * setup.widthMm,
    };
  });
  // A second row can set a lower bound. Never cut off other visible content.
  const widthMm = Math.max(1, setup.widthMm + delta, ...boxes
    .filter(box => box.element.visible && box.element.type !== "background")
    .map(box => box.x + box.width)) + (text.autoWidthRightMarginMm ?? 0);
  return {
    ...setup,
    widthMm,
    elements: boxes.map(({ element, x, width }) => element.type === "background"
      ? element
      : { ...element, x: x / widthMm * 100, width: width / widthMm * 100 }),
  };
}

export function labelQrColors(inverted: boolean | undefined, element: Extract<LabelElement, { type: "qr" }>) {
  return inverted
    ? { foregroundColor: "#ffffff", backgroundColor: "#000000" }
    : { foregroundColor: element.foregroundColor ?? "#000000", backgroundColor: element.backgroundColor ?? "#ffffff" };
}
