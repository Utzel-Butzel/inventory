"use client";

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
  useLayoutEffect,
  useRef,
} from "react";
import { useT } from "next-i18next/client";

import {
  canEncodeQr,
  Code128Barcode,
  QrCode,
} from "@/components/label-codes";
import {
  labelElementKey,
  type LabelElement,
  type LabelFontFamily,
  type LabelSetupDto,
  type LabelTextElement,
} from "@/lib/label-setup-contract";
import { labelTargetName, labelTargetUrl, type LabelResource } from "@/lib/label-target";
import { resolveLabelText, labelPlaceholderValues } from "@/lib/label-rich-text";
import { printableLabelBarcode } from "@/lib/label-barcode";

import { cropLabelImage, DEFAULT_CROP_PADDING, DEFAULT_CROP_TOLERANCE } from "@/lib/label-image-crop";

import { labelImageSource } from "@/lib/label-image-source";

import { LABEL_FONT_STACKS, defaultLabelFontSize, defaultLabelFontWeight } from "@/lib/label-typography";

import styles from "./label-printer.module.css";

export type { LabelResource } from "@/lib/label-target";

type TextElement = LabelTextElement;

const elementPosition = (element: LabelElement): CSSProperties => ({
  left: `${element.x}%`,
  top: `${element.y}%`,
  width: `${element.width}%`,
  height: `${element.height}%`,
});

function PrintableImage({
  resource,
  element,
  showPlaceholder,
  retryToken,
}: {
  resource: LabelResource;
  element: Extract<LabelElement, { type: "image" }>;
  showPlaceholder: boolean;
  retryToken: number;
}) {
  const { t } = useT("labels");
  const source = labelImageSource(element, resource);
  const tolerance = element.cropTolerance ?? DEFAULT_CROP_TOLERANCE;
  const padding = element.cropPadding ?? DEFAULT_CROP_PADDING;
  const cropKey = JSON.stringify([source, element.cropWhiteMargins, tolerance, padding, retryToken]);
  const [cropped, setCropped] = useState<{ key: string; url?: string; error?: boolean } | null>(null);
  useEffect(() => {
    if (!source || !element.cropWhiteMargins) return;
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) return;
      try { setCropped({ key: cropKey, url: cropLabelImage(image, tolerance, padding) }); }
      catch { setCropped({ key: cropKey, error: true }); }
    };
    image.onerror = () => { if (!cancelled) setCropped({ key: cropKey, error: true }); };
    image.src = source;
    return () => { cancelled = true; image.onload = null; image.onerror = null; };
  }, [source, element.cropWhiteMargins, tolerance, padding, cropKey]);
  const result = cropped?.key === cropKey ? cropped : null;
  const cropState = !element.cropWhiteMargins ? undefined : !result ? "pending" : result.error ? "error" : "ready";

  if (!source) {
    return showPlaceholder ? (
      <span className={styles.imagePlaceholder}>{t("renderer.noImage")}</span>
    ) : null;
  }

  return (
    // Stored images may use an authenticated same-origin route.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={`${source}-${retryToken}`}
      src={element.cropWhiteMargins && result?.url ? result.url : source}
      data-label-crop={cropState}
      data-label-photo-optimization={element.photoOptimization ?? "auto"}
      title={cropState === "error" ? t("renderer.cropError") : undefined}
      alt={element.source ? element.altText || t("designer.ownImage") : resource.cover?.altText || resource.name}
      className={`${styles.labelImage} printable-label-image`}
      style={{ objectFit: element.fit ?? "cover" }}
    />
  );
}

function defaultFontFamily(element: TextElement): LabelFontFamily {
  return ["name", "subtitle", "text"].includes(element.type) ? "sans" : "monospace";
}

function textStyle(element: TextElement, pixelsPerMm?: number): CSSProperties {
  const defaultSize = defaultLabelFontSize(element);
  return {
    "--label-line-height": element.lineHeight,
    fontWeight: element.fontWeight ?? (element.fontFamily === "barlow-semi-condensed" ? 700 : undefined),
    letterSpacing: `${element.letterSpacingEm ?? 0}em`,
    fontSize: pixelsPerMm
      ? `${(element.fontSizeMm ?? defaultSize) * pixelsPerMm}px`
      : `${element.fontSizeMm ?? defaultSize}mm`,
    fontFamily:
      LABEL_FONT_STACKS[element.fontFamily ?? defaultFontFamily(element)],
    textAlign: element.align ?? "left",
    whiteSpace: element.content ? "pre-wrap" : undefined,
    alignItems:
      element.verticalAlign === "top"
        ? "flex-start"
        : element.verticalAlign === "bottom"
          ? "flex-end"
          : "center",
    justifyContent:
      element.align === "center"
        ? "center"
        : element.align === "right"
          ? "flex-end"
          : "flex-start",
  } as CSSProperties;
}

function ShrinkingText({
  value,
  element,
}: {
  value: ReactNode;
  element: TextElement;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const maximumFontSizeMm = element.fontSizeMm ?? defaultLabelFontSize(element);
  const minimumFontSizeMm = Math.min(
    maximumFontSizeMm,
    element.minFontSizeMm ?? 1,
  );

  const fitText = useCallback(() => {
    const text = textRef.current;
    const container = text?.parentElement;
    if (!text || !container) return;

    text.style.fontSize = "";
    const maximumFontSizePx = Number.parseFloat(
      window.getComputedStyle(text).fontSize,
    );
    if (!Number.isFinite(maximumFontSizePx) || maximumFontSizePx <= 0) return;

    const minimumFontSizePx =
      maximumFontSizePx * (minimumFontSizeMm / maximumFontSizeMm);
    const fits = () =>
      text.scrollWidth <= container.clientWidth + 0.5 &&
      text.scrollHeight <= container.clientHeight + 0.5;

    if (fits()) return;

    text.style.fontSize = `${minimumFontSizePx}px`;
    if (!fits()) return;

    let smallestFit = minimumFontSizePx;
    let largestCandidate = maximumFontSizePx;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = (smallestFit + largestCandidate) / 2;
      text.style.fontSize = `${candidate}px`;
      if (fits()) {
        smallestFit = candidate;
      } else {
        largestCandidate = candidate;
      }
    }
    text.style.fontSize = `${Math.floor(smallestFit * 100) / 100}px`;
  }, [maximumFontSizeMm, minimumFontSizeMm]);

  useLayoutEffect(() => {
    fitText();
    let disposed = false;
    void document.fonts.ready.then(() => { if (!disposed) fitText(); });
    const text = textRef.current;
    const container = text?.parentElement;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fitText);
    observer.observe(container);
    return () => { disposed = true; observer.disconnect(); };
  }, [fitText, value, element.fontFamily, element.lineHeight, element.fontWeight, element.letterSpacingEm]);

  return (
    <span
      ref={textRef}
      className={`${styles.designedTextContent} ${styles.designedTextShrink}`}
    >
      {value}
    </span>
  );
}

function EllipsisText({
  value,
  element,
  labelHeightMm,
}: {
  value: ReactNode;
  element: TextElement;
  labelHeightMm: number;
}) {
  const fontSizeMm = element.fontSizeMm ?? defaultLabelFontSize(element);
  const availableHeightMm = (labelHeightMm * element.height) / 100;
  const lines = Math.max(1, Math.floor(availableHeightMm / (fontSizeMm * (element.lineHeight ?? 1.05))));
  return (
    <span
      className={`${styles.designedTextContent} ${styles.designedTextEllipsis}`}
      style={{ WebkitLineClamp: lines }}
    >
      {value}
    </span>
  );
}

export function LabelRenderer({
  resource,
  setup,
  origin,
  pixelsPerMm,
  showImagePlaceholder = false,
  imageRetryToken = 0,
  className,
}: {
  resource: LabelResource;
  setup: LabelSetupDto;
  origin: string;
  pixelsPerMm?: number;
  showImagePlaceholder?: boolean;
  imageRetryToken?: number;
  className?: string;
}) {
  const { t } = useT("labels");
  const shortUrl = labelTargetUrl(origin, resource);
  const qrValue = canEncodeQr(shortUrl) ? shortUrl : null;
  const barcodeCode = printableLabelBarcode(resource);
  const identifier = resource.stockUnit?.code ?? (resource.sku
    ? t("renderer.sku", { sku: resource.sku })
    : resource.id);
  const location =
    (resource.stockUnit ? resource.stockUnit.location : resource.location) ||
    t("renderer.inventoryCount", {
      type: resource.type,
      count: resource.stockUnit ? 1 : resource.quantity,
    });
  const dimensionUnit = pixelsPerMm ? "px" : "mm";
  const dimensionScale = pixelsPerMm ?? 1;

  return (
    <article
      className={`${styles.label} ${styles.designedLabel}${className ? ` ${className}` : ""}`}
      style={{
        width: `${setup.widthMm * dimensionScale}${dimensionUnit}`,
        height: `${setup.heightMm * dimensionScale}${dimensionUnit}`,
      }}
      aria-label={t("renderer.printable", { name: labelTargetName(resource) })}
    >
      {setup.elements
        .filter((element) => element.visible)
        .sort((left, right) =>
          Number(right.type === "background") - Number(left.type === "background"),
        )
        .map((element) => {
          const position = elementPosition(element);
          if (element.type === "background") {
            return element.source ? (
              <div
                key={labelElementKey(element)}
                className={styles.designedElement}
                style={position}
                aria-hidden="true"
              >
                {/* User-provided data URLs need to render identically in preview and print. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={element.source}
                  alt=""
                  className={styles.designedBackground}
                  style={{
                    objectFit: element.fit ?? "cover",
                    opacity: element.opacity ?? 1,
                  }}
                />
              </div>
            ) : null;
          }
          if (element.type === "qr") {
            return (
              <div key={labelElementKey(element)} data-label-qr className={styles.designedElement} style={position}>
                {qrValue ? (
                  <QrCode
                    value={qrValue}
                    className={styles.designedQr}
                    ariaLabel={t("renderer.qr", { value: qrValue })}
                    foregroundColor={element.foregroundColor}
                    backgroundColor={element.backgroundColor}
                    quietZoneModules={element.quietZoneModules}
                  />
                ) : (
                  <span className={styles.qrUnavailable}>
                    {t("renderer.qrTooLong")}
                  </span>
                )}
              </div>
            );
          }
          if (element.type === "image") {
            return (
              <div key={labelElementKey(element)} className={styles.designedElement} style={position}>
                <PrintableImage
                  resource={resource}
                  element={element}
                  showPlaceholder={showImagePlaceholder}
                  retryToken={imageRetryToken}
                />
              </div>
            );
          }
          if (element.type === "barcode") {
            return (
              <div key={labelElementKey(element)} className={styles.designedElement} style={position}>
                <Code128Barcode
                  value={barcodeCode}
                  className={styles.designedBarcode}
                  ariaLabel={t("renderer.barcode", { value: barcodeCode })}
                />
              </div>
            );
          }

          const plainValue =
            element.type === "name"
              ? resource.name
              : element.type === "subtitle"
                ? resource.subtitle ?? ""
              : element.type === "identifier"
                ? identifier
                : element.type === "url"
                  ? shortUrl
                  : location;
          const value = element.content
            ? resolveLabelText(element.content, labelPlaceholderValues(resource, origin)).map((run, index) => (
                <span key={index} style={{ fontWeight: run.weight ?? defaultLabelFontWeight(element), fontStyle: run.italic ? "italic" : "normal", textDecorationLine: run.underline ? "underline" : "none" }}>{run.text}</span>
              ))
            : plainValue;
          const textOverflow = element.textOverflow ?? "ellipsis";
          return (
            <div
              key={labelElementKey(element)}
              className={`${styles.designedElement} ${styles.designedText} ${
                element.type === "name"
                  ? styles.designedName
                  : element.type === "url"
                    ? styles.designedUrl
                    : styles.designedMetadata
              }`}
              style={{ ...position, ...textStyle(element, pixelsPerMm) }}
            >
              {textOverflow === "shrink" ? (
                <ShrinkingText value={value} element={element} />
              ) : (
                <EllipsisText
                  value={value}
                  element={element}
                  labelHeightMm={setup.heightMm}
                />
              )}
            </div>
          );
        })}
    </article>
  );
}
