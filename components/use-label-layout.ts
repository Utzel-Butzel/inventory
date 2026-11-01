"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import { useT } from "next-i18next/client";
import { automaticLabelText, resolveLabelLayout } from "@/lib/label-dynamic-layout";
import { defaultLabelTextContent, labelPlaceholderValues, resolveLabelText } from "@/lib/label-rich-text";
import { hugsRowContent, isRowText, resolveLabelRow } from "@/lib/label-auto-layout";
import { labelElementKey, type LabelSetupDto } from "@/lib/label-setup-contract";
import type { LabelResource } from "@/lib/label-target";
import { defaultLabelFontSize, defaultLabelFontWeight, LABEL_FONT_STACKS, LABEL_TEXT_PIXELS_PER_MM } from "@/lib/label-typography";

export function useLabelLayout(setup: LabelSetupDto, resource: LabelResource, origin: string) {
  const { t } = useT("labels");
  const automaticText = automaticLabelText(setup.elements);
  const texts = setup.layout ? setup.elements.filter(isRowText).filter(element => element.visible && hugsRowContent(element)) : automaticText ? [automaticText] : [];
  const values = labelPlaceholderValues(resource, origin);
  const measurements = texts.map(text => {
    const runs = resolveLabelText(defaultLabelTextContent(text), text.content ? values : {
      ...values,
      Identifier: resource.stockUnit?.code ?? (resource.sku ? t("renderer.sku", { sku: resource.sku }) : resource.id),
      Location: values.Location || t("renderer.inventoryCount", { type: resource.type, count: resource.stockUnit ? 1 : resource.quantity }),
    });
    // A stable dependency prevents measuring again when only another element moves.
    return {
      id: labelElementKey(text),
      runs,
      fontFamily: text.fontFamily ?? (["name", "subtitle", "text"].includes(text.type) ? "sans" : "monospace"),
      fontSizeMm: text.fontSizeMm ?? defaultLabelFontSize(text),
      fontWeight: defaultLabelFontWeight(text),
      letterSpacingEm: text.letterSpacingEm ?? 0,
    };
  });
  const measurementKey = JSON.stringify(measurements);
  const [measurement, setMeasurement] = useState<{ key: string; widths: Record<string, number> }>({ key: "", widths: {} });

  useLayoutEffect(() => {
    const styles = JSON.parse(measurementKey) as {
      id: string; runs: { text: string; weight?: number; italic?: boolean }[]; fontFamily: keyof typeof LABEL_FONT_STACKS;
      fontSizeMm: number; fontWeight: number; letterSpacingEm: number;
    }[];
    // Measure actual browser typography, including mixed weights and explicit newlines.
    // A fixed scale makes the resulting physical length independent of preview zoom.
    const pixelsPerMm = LABEL_TEXT_PIXELS_PER_MM;
    const probes = styles.map(style => {
      const probe = document.createElement("span");
      probe.setAttribute("aria-hidden", "true");
      Object.assign(probe.style, {
        position: "fixed", left: "-100000px", top: "0", visibility: "hidden",
        display: "block", width: "max-content", whiteSpace: "pre", lineHeight: "1",
        fontFamily: LABEL_FONT_STACKS[style.fontFamily], fontSize: `${style.fontSizeMm * pixelsPerMm}px`,
        fontOpticalSizing: "none",
        fontWeight: String(style.fontWeight), letterSpacing: `${style.letterSpacingEm}em`,
      });
      for (const run of style.runs) {
        const span = document.createElement("span");
        span.textContent = run.text;
        span.style.fontWeight = String(run.weight ?? style.fontWeight);
        span.style.fontStyle = run.italic ? "italic" : "normal";
        probe.append(span);
      }
      document.body.append(probe);
      return { id: style.id, probe };
    });
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      // Small physical allowance for glyph overhang and browser rounding.
      const widths = Object.fromEntries(probes.map(({ id, probe }) => [id,
        Math.ceil(probe.getBoundingClientRect().width / pixelsPerMm * 100) / 100 + 0.3]));
      setMeasurement(previous => previous.key === measurementKey && JSON.stringify(previous.widths) === JSON.stringify(widths)
        ? previous : { key: measurementKey, widths });
    };
    measure();
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener("loadingdone", measure);
    return () => { disposed = true; probes.forEach(({ probe }) => probe.remove()); document.fonts.removeEventListener("loadingdone", measure); };
  }, [measurementKey]);

  return useMemo(() => {
    const widths = measurement.key === measurementKey ? measurement.widths : {};
    if (setup.layout) return resolveLabelRow(setup, widths);
    const text = automaticLabelText(setup.elements);
    return text && widths[labelElementKey(text)] !== undefined ? resolveLabelLayout(setup, widths[labelElementKey(text)]) : setup;
  }, [setup, measurementKey, measurement]);
}
