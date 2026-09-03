"use client";

import {
  type CSSProperties,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";
import { useT } from "next-i18next/client";

import {
  canEncodeQr,
  Code128Barcode,
  QrCode,
} from "@/components/label-codes";
import type {
  LabelElement,
  LabelFontFamily,
  LabelSetupDto,
} from "@/lib/label-setup-contract";
import type { ClientResource } from "@/lib/client-types";
import { resourceShortUrl } from "@/lib/resource-short-link";
import { printableLabelBarcode } from "@/lib/label-barcode";

import styles from "./label-printer.module.css";

export type LabelResource = Pick<
  ClientResource,
  | "id"
  | "name"
  | "sku"
  | "barcode"
  | "location"
  | "type"
  | "quantity"
  | "cover"
>;

type TextElement = Extract<
  LabelElement,
  { type: "name" | "identifier" | "url" | "location" }
>;

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
  const source = resource.cover?.url ?? null;
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
      src={source}
      alt={resource.cover?.altText || resource.name}
      className={`${styles.labelImage} printable-label-image`}
      style={{ objectFit: element.fit ?? "cover" }}
    />
  );
}

function defaultFontSizeMm(element: TextElement) {
  return element.type === "name" ? 3.8 : element.type === "url" ? 1.8 : 2.5;
}

const FONT_FAMILY_STACKS: Record<LabelFontFamily, string> = {
  sans: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  monospace:
    'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
};

function defaultFontFamily(element: TextElement): LabelFontFamily {
  return element.type === "name" ? "sans" : "monospace";
}

function textStyle(element: TextElement, pixelsPerMm?: number): CSSProperties {
  const defaultSize = defaultFontSizeMm(element);
  return {
    fontSize: pixelsPerMm
      ? `${(element.fontSizeMm ?? defaultSize) * pixelsPerMm}px`
      : `${element.fontSizeMm ?? defaultSize}mm`,
    fontFamily:
      FONT_FAMILY_STACKS[element.fontFamily ?? defaultFontFamily(element)],
    textAlign: element.align ?? "left",
    justifyContent:
      element.align === "center"
        ? "center"
        : element.align === "right"
          ? "flex-end"
          : "flex-start",
  };
}

function ShrinkingText({
  value,
  element,
}: {
  value: string;
  element: TextElement;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const maximumFontSizeMm = element.fontSizeMm ?? defaultFontSizeMm(element);
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
    const text = textRef.current;
    const container = text?.parentElement;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fitText);
    observer.observe(container);
    return () => observer.disconnect();
  }, [fitText, value]);

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
  value: string;
  element: TextElement;
  labelHeightMm: number;
}) {
  const fontSizeMm = element.fontSizeMm ?? defaultFontSizeMm(element);
  const availableHeightMm = (labelHeightMm * element.height) / 100;
  const lines = Math.max(1, Math.floor(availableHeightMm / (fontSizeMm * 1.05)));
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
  const shortUrl = resourceShortUrl(origin, resource.id);
  const qrValue = canEncodeQr(shortUrl) ? shortUrl : null;
  const barcodeCode = printableLabelBarcode(resource);
  const identifier = resource.sku
    ? t("renderer.sku", { sku: resource.sku })
    : resource.id;
  const location =
    resource.location ||
    t("renderer.inventoryCount", {
      type: resource.type,
      count: resource.quantity,
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
      aria-label={t("renderer.printable", { name: resource.name })}
    >
      {setup.elements
        .filter((element) => element.visible)
        .sort((left, right) =>
          left.type === "background"
            ? -1
            : right.type === "background"
              ? 1
              : 0,
        )
        .map((element) => {
          const position = elementPosition(element);
          if (element.type === "background") {
            return element.source ? (
              <div
                key={element.type}
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
              <div key={element.type} className={styles.designedElement} style={position}>
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
              <div key={element.type} className={styles.designedElement} style={position}>
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
              <div key={element.type} className={styles.designedElement} style={position}>
                <Code128Barcode
                  value={barcodeCode}
                  className={styles.designedBarcode}
                  ariaLabel={t("renderer.barcode", { value: barcodeCode })}
                />
              </div>
            );
          }

          const value =
            element.type === "name"
              ? resource.name
              : element.type === "identifier"
                ? identifier
                : element.type === "url"
                  ? shortUrl
                  : location;
          const textOverflow = element.textOverflow ?? "ellipsis";
          return (
            <div
              key={element.type}
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
