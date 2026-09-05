"use client";

import { Check, ExternalLink, LoaderCircle, Plus, Truck, X } from "lucide-react";
import { useT } from "next-i18next/client";
import { useRef, useState } from "react";

import { Field, FormActions, Input, Select, Textarea } from "@/components/form-controls";
import { Badge, Button, Card } from "@/components/ui";
import { fetchJson } from "@/lib/client-types";

import { formatDateTime, statusTone } from "./presentation";
import type { Order, Shipment, ShipmentStatus } from "./types";

export function SalesShipments({
  order,
  locale,
  onChanged,
  reportError,
  reportNotice,
}: {
  order: Order;
  locale: string;
  onChanged: () => Promise<void>;
  reportError: (message: string | null) => void;
  reportNotice: (message: string | null) => void;
}) {
  const { t } = useT("orders");
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actingShipmentId, setActingShipmentId] = useState<string | null>(null);
  const [carrierCode, setCarrierCode] = useState("dhl");
  const [service, setService] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [note, setNote] = useState("");
  const createKey = useRef<string | null>(null);

  const activeShipments = order.shipments.filter(
    (shipment) => shipment.status !== "cancelled",
  );
  const packedByLine = new Map<string, number>();
  const packedUnitIds = new Set<string>();
  for (const shipment of activeShipments) {
    for (const line of shipment.lines) {
      packedByLine.set(
        line.orderLineId,
        (packedByLine.get(line.orderLineId) ?? 0) + line.quantity,
      );
      for (const unit of line.units) packedUnitIds.add(unit.stockUnitId);
    }
  }
  const shippableLines = order.lines.flatMap<{
    orderLineId: string;
    name: string;
    quantity: number;
    unitIds?: string[];
  }>((line) => {
    const remaining = Math.max(
      0,
      line.fulfilledQuantity -
      line.returnedQuantity -
      (packedByLine.get(line.id) ?? 0),
    );
    if (!remaining) return [];
    if (line.trackingMode === "serialized") {
      const unitIds = line.units
        .filter(
          (unit) =>
            unit.status === "fulfilled" && !packedUnitIds.has(unit.stockUnitId),
        )
        .slice(0, remaining)
        .map((unit) => unit.stockUnitId);
      return unitIds.length
        ? [{ orderLineId: line.id, name: line.resourceName, quantity: unitIds.length, unitIds }]
        : [];
    }
    return [{ orderLineId: line.id, name: line.resourceName, quantity: remaining }];
  });
  const shippableQuantity = shippableLines.reduce(
    (total, line) => total + line.quantity,
    0,
  );

  function resetForm() {
    setCarrierCode("dhl");
    setService("");
    setTrackingNumber("");
    setTrackingUrl("");
    setNote("");
    createKey.current = null;
  }

  async function createShipment() {
    if (!trackingNumber.trim() || !shippableLines.length) return;
    createKey.current ??= crypto.randomUUID();
    setSaving(true);
    reportError(null);
    reportNotice(null);
    try {
      await fetchJson(`/api/v1/orders/${order.id}/shipments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createKey.current,
        },
        body: JSON.stringify({
          carrierCode,
          service: service.trim() || undefined,
          trackingNumber: trackingNumber.trim(),
          trackingUrl: trackingUrl.trim() || undefined,
          status: "ready",
          note,
          lines: shippableLines.map((line) => ({
            orderLineId: line.orderLineId,
            quantity: line.quantity,
            ...(line.unitIds ? { unitIds: line.unitIds } : {}),
          })),
        }),
      });
      resetForm();
      setFormOpen(false);
      await onChanged();
      reportNotice(t("shipments.notices.created"));
    } catch (shipmentError) {
      reportError(
        shipmentError instanceof Error
          ? shipmentError.message
          : t("shipments.errors.create"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(shipment: Shipment, status: ShipmentStatus) {
    setActingShipmentId(shipment.id);
    reportError(null);
    reportNotice(null);
    try {
      await fetchJson(`/api/v1/orders/${order.id}/shipments/${shipment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await onChanged();
      reportNotice(t(`shipments.notices.${status}`));
    } catch (shipmentError) {
      reportError(
        shipmentError instanceof Error
          ? shipmentError.message
          : t("shipments.errors.update"),
      );
    } finally {
      setActingShipmentId(null);
    }
  }

  return (
    <section className="border-t border-border bg-surface-subtle px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Truck className="size-4 text-brand" aria-hidden="true" />
            {t("shipments.title")}
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted">
            {t("shipments.description")}
          </p>
        </div>
        {shippableQuantity > 0 && !["cancelled", "returned"].includes(order.status) ? (
          <Button
            size="sm"
            variant={formOpen ? "ghost" : "secondary"}
            onClick={() => setFormOpen((current) => !current)}
          >
            {formOpen ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
            {formOpen
              ? t("shipments.actions.close")
              : t("shipments.actions.create", { count: shippableQuantity })}
          </Button>
        ) : null}
      </div>

      {formOpen ? (
        <Card className="mt-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t("shipments.fields.carrier")} required>
              <Select value={carrierCode} onChange={(event) => setCarrierCode(event.target.value)}>
                {(["dhl", "dpd", "ups", "gls", "hermes", "other"] as const).map(
                  (carrier) => (
                    <option key={carrier} value={carrier}>
                      {t(`shipments.carriers.${carrier}`)}
                    </option>
                  ),
                )}
              </Select>
            </Field>
            <Field label={t("shipments.fields.trackingNumber")} required>
              <Input
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
                maxLength={180}
              />
            </Field>
            <Field label={t("shipments.fields.service")}>
              <Input
                value={service}
                onChange={(event) => setService(event.target.value)}
                maxLength={120}
                placeholder={t("shipments.fields.servicePlaceholder")}
              />
            </Field>
            <Field label={t("shipments.fields.trackingUrl")}>
              <Input
                type="url"
                value={trackingUrl}
                onChange={(event) => setTrackingUrl(event.target.value)}
                maxLength={2048}
                placeholder="https://…"
              />
            </Field>
            <Field label={t("shipments.fields.note")} className="sm:col-span-2 lg:col-span-4">
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                maxLength={20_000}
              />
            </Field>
          </div>
          <div className="mt-4 rounded-xl border border-border bg-surface-subtle p-3">
            <p className="text-xs font-semibold text-foreground">
              {t("shipments.included")}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {shippableLines.map((line) => (
                <li key={line.orderLineId}>
                  {line.quantity} × {line.name}
                  {line.unitIds?.length
                    ? ` · ${line.unitIds
                      .map(
                        (unitId) =>
                          order.lines
                            .find((orderLine) => orderLine.id === line.orderLineId)
                            ?.units.find((unit) => unit.stockUnitId === unitId)?.code ??
                          unitId,
                      )
                      .join(", ")}`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
          <FormActions className="mt-4">
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
              {t("actions.cancel")}
            </Button>
            <Button
              type="button"
              disabled={saving || !trackingNumber.trim()}
              onClick={() => void createShipment()}
            >
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
              {t("shipments.actions.saveReady")}
            </Button>
          </FormActions>
        </Card>
      ) : null}

      {order.shipments.length ? (
        <div className="mt-4 grid gap-3">
          {order.shipments.map((shipment) => (
            <article key={shipment.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm text-foreground">
                      {t(`shipments.carriers.${shipment.carrierCode}`, {
                        defaultValue: shipment.carrierCode.toUpperCase(),
                      })}
                      {shipment.service ? ` · ${shipment.service}` : ""}
                    </strong>
                    <Badge tone={statusTone(shipment.status)}>
                      {t(`status.${shipment.status}`)}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    {shipment.trackingNumber ? (
                      shipment.trackingUrl ? (
                        <a
                          href={shipment.trackingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
                        >
                          {shipment.trackingNumber}
                          <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                      ) : (
                        <span>{shipment.trackingNumber}</span>
                      )
                    ) : null}
                    <span>
                      {t("shipments.quantity", { count: shipment.totalQuantity })}
                    </span>
                    <span>
                      {shipment.shippedAt
                        ? t("shipments.shippedAt", {
                          date: formatDateTime(shipment.shippedAt, locale),
                        })
                        : t("shipments.createdAt", {
                          date: formatDateTime(shipment.createdAt, locale),
                        })}
                    </span>
                    {shipment.deliveredAt ? (
                      <span>
                        {t("shipments.deliveredAt", {
                          date: formatDateTime(shipment.deliveredAt, locale),
                        })}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {shipment.status === "ready" ? (
                    <Button
                      size="sm"
                      disabled={actingShipmentId !== null}
                      onClick={() => void updateStatus(shipment, "shipped")}
                    >
                      {actingShipmentId === shipment.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Truck className="size-3.5" />}
                      {t("shipments.actions.markShipped")}
                    </Button>
                  ) : null}
                  {shipment.status === "shipped" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={actingShipmentId !== null}
                      onClick={() => void updateStatus(shipment, "in_transit")}
                    >
                      {actingShipmentId === shipment.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Truck className="size-3.5" />}
                      {t("shipments.actions.markInTransit")}
                    </Button>
                  ) : null}
                  {["shipped", "in_transit", "exception"].includes(shipment.status) ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={actingShipmentId !== null}
                      onClick={() => void updateStatus(shipment, "delivered")}
                    >
                      {actingShipmentId === shipment.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                      {t("shipments.actions.markDelivered")}
                    </Button>
                  ) : null}
                </div>
              </div>
              <ul className="mt-3 space-y-1 text-xs text-muted">
                {shipment.lines.map((line) => (
                  <li key={line.id}>
                    {line.quantity} × {line.resourceName}
                    {line.units.length
                      ? ` · ${line.units.map((unit) => unit.code).join(", ")}`
                      : ""}
                  </li>
                ))}
              </ul>
              {shipment.note ? (
                <p className="mt-3 text-xs leading-5 text-muted">{shipment.note}</p>
              ) : null}
              {shipment.events.length ? (
                <details className="mt-3 border-t border-border pt-3 text-xs text-muted">
                  <summary className="cursor-pointer font-semibold text-foreground">
                    {t("shipments.history", { count: shipment.events.length })}
                  </summary>
                  <ol className="mt-2 space-y-1.5">
                    {[...shipment.events].reverse().map((event) => (
                      <li key={event.id}>
                        {formatDateTime(event.occurredAt, locale)} · {t(`status.${event.toStatus}`)}
                        {event.note ? ` · ${event.note}` : ""}
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">
          {shippableQuantity
            ? t("shipments.emptyReady")
            : t("shipments.emptyUnfulfilled")}
        </p>
      )}
    </section>
  );
}

