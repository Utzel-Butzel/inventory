"use client";

import { type CSSProperties } from "react";
import { useT } from "next-i18next/client";

import {
  canEncodeQr,
  canEncodeCode128B,
  Code128Barcode,
  QrCode,
} from "@/components/label-codes";
import type { LabelElement, LabelSetupDto } from "@/lib/label-setup-contract";
import type { ClientResource } from "@/lib/client-types";
import { resourceShortUrl } from "@/lib/resource-short-link";

import styles from "./label-printer.module.css";

export type LabelResource = Pick<
  ClientResource,
  "id" | "name" | "sku" | "location" | "type" | "quantity" | "cover"
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

function textStyle(
  element: Extract<
    LabelElement,
    { type: "name" | "identifier" | "url" | "location" }
  >,
  pixelsPerMm?: number,
): CSSProperties {
  const defaultSize = element.type === "name" ? 3.8 : element.type === "url" ? 1.8 : 2.5;
  return {
    fontSize: pixelsPerMm
      ? `${(element.fontSizeMm ?? defaultSize) * pixelsPerMm}px`
      : `${element.fontSizeMm ?? defaultSize}mm`,
    textAlign: element.align ?? "left",
    justifyContent:
      element.align === "center"
        ? "center"
        : element.align === "right"
          ? "flex-end"
          : "flex-start",
  };
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
  const visibleCode = resource.sku?.trim() || resource.id;
  const barcodeCode = canEncodeCode128B(visibleCode) ? visibleCode : resource.id;
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
        .map((element) => {
          const position = elementPosition(element);
          if (element.type === "qr") {
            return (
              <div key={element.type} className={styles.designedElement} style={position}>
                {qrValue ? (
                  <QrCode
                    value={qrValue}
                    className={styles.designedQr}
                    ariaLabel={t("renderer.qr", { value: qrValue })}
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
              {value}
            </div>
          );
        })}
    </article>
  );
}
