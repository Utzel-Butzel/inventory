"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import { useT } from "next-i18next/client";
import { computeLabelAutoLayout } from "@/lib/label-layout-engine";
import { automaticLabelText, resolveLabelLayout } from "@/lib/label-dynamic-layout";
import { defaultLabelTextContent, labelPlaceholderValues, resolveLabelText } from "@/lib/label-rich-text";
import { hugsRowContent, isRowText, resolveLabelRow, type ResolvedLabelSetup } from "@/lib/label-auto-layout";
import { labelElementKey, type LabelSetupDto } from "@/lib/label-setup-contract";
import type { LabelResource } from "@/lib/label-target";
import { defaultLabelFontSize, defaultLabelFontWeight, LABEL_FONT_STACKS, LABEL_TEXT_PIXELS_PER_MM } from "@/lib/label-typography";

export function useLabelLayout(setup: LabelSetupDto, resource: LabelResource, origin: string): ResolvedLabelSetup {
  const { t } = useT("labels");
  const automaticText = automaticLabelText(setup.elements);
  const texts = setup.layout ? setup.elements.filter(isRowText).filter(element => element.visible && (hugsRowContent(element) || element.heightSizing === "hug")) : automaticText ? [automaticText] : [];
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
      lineHeight: text.lineHeight ?? 1.08,
      heightSizing: text.heightSizing,
    };
  });
  const measurementKey = JSON.stringify(measurements);
  const geometryKey = JSON.stringify({ widthMm: setup.widthMm, heightMm: setup.heightMm, layout: setup.layout,
    elements: setup.elements.map(element => ({ id: element.id, type: element.type, x: element.x, y: element.y, width: element.width, height: element.height,
      visible: element.visible, groupId: element.groupId, rowOrder: element.rowOrder, rowWidthMm: element.rowWidthMm, rowHeightMm: element.rowHeightMm,
      widthSizing: element.widthSizing, heightSizing: element.heightSizing, ignoreLayout: element.ignoreLayout, rowSizing: "rowSizing" in element ? element.rowSizing : undefined })) });
  const [measurement, setMeasurement] = useState<{ key: string; geometry: string; widths: Record<string, number>; heights: Record<string, number> }>({ key: "", geometry: "", widths: {}, heights: {} });

  useLayoutEffect(() => {
    const styles = JSON.parse(measurementKey) as {
      id: string; runs: { text: string; weight?: number; italic?: boolean }[]; fontFamily: keyof typeof LABEL_FONT_STACKS;
      fontSizeMm: number; fontWeight: number; letterSpacingEm: number; lineHeight: number; heightSizing?: string;
    }[];
    // Measure actual browser typography, including mixed weights and explicit newlines.
    // A fixed scale makes the resulting physical length independent of preview zoom.
    const pixelsPerMm = LABEL_TEXT_PIXELS_PER_MM;
    const probes = styles.map(style => {
      const probe = document.createElement("span");
      probe.setAttribute("aria-hidden", "true");
      Object.assign(probe.style, {
        position: "fixed", left: "-100000px", top: "0", visibility: "hidden",
        display: "block", width: "max-content", whiteSpace: "pre", lineHeight: String(style.lineHeight),
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
      return { id: style.id, probe, hugHeight: style.heightSizing === "hug" };
    });
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      // Small physical allowance for glyph overhang and browser rounding.
      for (const { probe } of probes) { probe.style.width = "max-content"; probe.style.whiteSpace = "pre"; }
      const widths = Object.fromEntries(probes.map(({ id, probe }) => [id,
        Math.ceil(probe.getBoundingClientRect().width / pixelsPerMm * 100) / 100 + 0.3]));
      let heights: Record<string, number> = {};
      const geometry = JSON.parse(geometryKey) as LabelSetupDto;
      for (let pass = 0; pass < 3; pass++) {
        const layout = computeLabelAutoLayout(geometry, { widths, heights });
        const next: Record<string, number> = {};
        for (const { id, probe, hugHeight } of probes) {
          if (!hugHeight || !layout.elements[id]) continue;
          probe.style.width = `${layout.elements[id].width * pixelsPerMm}px`;
          probe.style.whiteSpace = "pre-wrap";
          probe.style.overflowWrap = "anywhere";
          next[id] = Math.ceil(probe.getBoundingClientRect().height / pixelsPerMm * 100) / 100;
        }
        if (JSON.stringify(next) === JSON.stringify(heights)) break;
        heights = next;
      }
      setMeasurement(previous => previous.key === measurementKey && previous.geometry === geometryKey && JSON.stringify(previous.widths) === JSON.stringify(widths) && JSON.stringify(previous.heights) === JSON.stringify(heights)
        ? previous : { key: measurementKey, geometry: geometryKey, widths, heights });
    };
    measure();
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener("loadingdone", measure);
    return () => { disposed = true; probes.forEach(({ probe }) => probe.remove()); document.fonts.removeEventListener("loadingdone", measure); };
  }, [measurementKey, geometryKey]);

  return useMemo(() => {
    const widths = measurement.key === measurementKey ? measurement.widths : {};
    if (setup.layout) return resolveLabelRow(setup, widths, measurement.geometry === geometryKey ? measurement.heights : {});
    const text = automaticLabelText(setup.elements);
    return text && widths[labelElementKey(text)] !== undefined ? resolveLabelLayout(setup, widths[labelElementKey(text)]) : setup;
  }, [setup, measurementKey, geometryKey, measurement]);
}
