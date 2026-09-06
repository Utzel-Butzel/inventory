"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useT } from "next-i18next/client";
import { LoaderCircle, Save, SlidersHorizontal, X, RefreshCw } from "lucide-react";
import { type ClientRoomSceneManifest } from "@/lib/client-types";
import { RoomSurfaceEditor } from "@/components/room-surface-editor";
import { RoomFurniturePicker } from "@/components/room-furniture-picker";
import {
  roomSceneSchema,
  type RoomObject,
  type RoomScene,
} from "@/lib/room-scene-contract";
import {
  roomSceneCenterPosition,
  type RoomEdit,
} from "@/lib/room-scene-editor";
import { localArkitToGeographic } from "@/lib/spatial-georeference";

const AnchorPicker = dynamic(
  () => import("./room-anchor-picker").then((m) => m.RoomAnchorPicker),
  { ssr: false },
);
const inputClass =
  "w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-foreground";
type Tab = "architecture" | "furniture" | "map" | "rooms" | "scan";
export function RoomSceneEditor({
  manifest,
  selectedObjectId,
  onSelectObject,
  onPreview,
  onPartitionPreview,
  onSaved,
  mapSetupRequest = 0,
  onMapSaved,
}: {
  manifest: ClientRoomSceneManifest;
  selectedObjectId: string | null;
  onSelectObject: (id: string | null) => void;
  onPartitionPreview?: (
    value: { axis: "x" | "z"; position: number } | null,
  ) => void;
  onPreview: (scene: RoomScene | null) => void;
  onSaved: (
    manifest: ClientRoomSceneManifest,
    newScanId: string | null,
  ) => Promise<void>;
  mapSetupRequest?: number;
  onMapSaved?: () => void;
}) {
  const { t } = useT("spatial");
  const [open, setOpen] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("furniture");
  const [draft, setDraft] = useState<RoomObject | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const anchor = manifest.scan.georeference ?? manifest.georeference;
  const centerPosition = roomSceneCenterPosition(
    manifest.scan.scene,
    manifest.scan.layoutTransform,
  );
  const geographicCenter = anchor
    ? localArkitToGeographic(centerPosition, anchor)
    : null;
  const [latitude, setLatitude] = useState<number | null>(
    geographicCenter?.latitude ?? null,
  );
  const [longitude, setLongitude] = useState<number | null>(
    geographicCenter?.longitude ?? null,
  );
  const [heading, setHeading] = useState(anchor?.headingDegrees ?? 0);
  const [name, setName] = useState("");
  const [width, setWidth] = useState(4);
  const [depth, setDepth] = useState(4);
  const [height, setHeight] = useState(2.6);
  const [axis, setAxis] = useState<"x" | "z">("x");
  const [ratio, setRatio] = useState(0.5);
  const [replacement, setReplacement] = useState<RoomScene | null>(null);
  useEffect(() => {
    setDraft(null);
    onPreview(null);
    if (selectedObjectId) setTab("furniture");
  }, [selectedObjectId, onPreview]);
  useEffect(() => {
    if (!mapSetupRequest) return;
    setOpen(true);
    setTab("map");
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [mapSetupRequest]);
  useEffect(() => {
    if (tab !== "rooms" || !(open || selectedObjectId)) {
      onPartitionPreview?.(null);
      return;
    }
    const a = axis === "x" ? 0 : 2;
    const bounds = manifest.scan.scene.bounds;
    onPartitionPreview?.({
      axis,
      position: bounds.min[a] + ratio * (bounds.max[a] - bounds.min[a]),
    });
    return () => onPartitionPreview?.(null);
  }, [
    tab,
    open,
    selectedObjectId,
    axis,
    ratio,
    manifest.scan.scene,
    onPartitionPreview,
  ]);
  const object =
    draft?.id === selectedObjectId
      ? draft
      : (manifest.scan.scene.objects.find((o) => o.id === selectedObjectId) ??
        null);
  const changeObject = (next: RoomObject) => {
    setDraft(next);
    onPreview({
      ...manifest.scan.scene,
      objects: manifest.scan.scene.objects.map((o) =>
        o.id === next.id ? next : o,
      ),
    });
  };
  const cancel = () => {
    setDraft(null);
    setReplacement(null);
    onPreview(null);
    setError(null);
  };
  const save = async (edit: RoomEdit) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/v1/room-scans/${manifest.scan.id}/edit`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(edit),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "edit-failed");
      cancel();
      await onSaved(payload.scene, payload.newScanId);
      if (edit.action === "anchor") onMapSaved?.();
      setNotice(t("editor.saved"));
    } catch (e) {
      setError(
        t(`editor.errors.${e instanceof Error ? e.message : "edit-failed"}`, {
          defaultValue: t("editor.errors.edit-failed"),
        }),
      );
    } finally {
      setBusy(false);
    }
  };
  const revision = manifest.scan.revision;
  const numeric = (
    label: string,
    value: number,
    change: (n: number) => void,
    min?: number,
    max?: number,
    step = 0.1,
  ) => (
    <label className="block space-y-1 text-xs text-muted">
      <span>{label}</span>
      <input
        type="number"
        className={inputClass}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          if (Number.isFinite(e.target.valueAsNumber))
            change(e.target.valueAsNumber);
        }}
      />
    </label>
  );
  const saveButton = (
    action: () => void,
    disabled = false,
    label = t("editor.save"),
  ) => (
    <button
      type="button"
      onClick={action}
      disabled={busy || disabled}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-solid px-3 py-2 text-xs font-semibold text-on-brand disabled:opacity-40"
    >
      {busy ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : (
        <Save className="size-3.5" />
      )}
      {label}
    </button>
  );
  const expanded = open || Boolean(selectedObjectId);
  return (
    <div ref={editorRef} className="shrink-0 border-b border-border">
      <button
        type="button"
        className="flex w-full items-center gap-2 p-3 text-sm font-semibold text-foreground"
        aria-expanded={expanded}
        onClick={() => {
          if (expanded) {
            cancel();
            onSelectObject(null);
          }
          setOpen(!expanded);
        }}
      >
        <SlidersHorizontal className="size-4" />
        {t("editor.title")}
      </button>
      {manifest.scan.scene.presentation ? <p role="status" className="px-3 pb-2 text-[11px] text-brand">{t("editor.regenerated")}</p> : null}
      {expanded ? (
        <div className="space-y-3 px-3 pb-3">
          <div className="rounded-lg border border-border bg-surface-muted p-2.5">
            <button type="button" disabled={busy} onClick={() => void save({ action: "regenerate", revision })} className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface px-2 py-2 text-xs font-semibold text-foreground disabled:opacity-50">
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {t("editor.regenerate")}
            </button>
            <p className="mt-2 text-[11px] text-muted">{t("editor.regenerateHint")}</p>
          </div>
          <div
            className="grid grid-cols-2 gap-1"
            role="group"
            aria-label={t("editor.title")}
          >
            {(["furniture", "architecture", "map", "rooms", "scan"] as Tab[]).map((key) => (
              <button
                type="button"
                key={key}
                disabled={busy}
                aria-pressed={tab === key}
                className={`rounded-lg px-2 py-1.5 text-xs ${tab === key ? "bg-brand-soft text-brand-strong" : "bg-surface-muted text-muted"}`}
                onClick={() => {
                  cancel();
                  setTab(key);
                }}
              >
                {t(`editor.tabs.${key}`)}
              </button>
            ))}
          </div>
          {tab === "architecture" ? <RoomSurfaceEditor key={`${manifest.scan.id}:${revision}`} manifest={manifest} busy={busy} onPreview={onPreview} onSave={save} /> : null}
          {tab === "furniture" ? (
            <>
              <p className="text-xs text-muted">{t("editor.furnitureHint")}</p>
              <label className="block text-xs text-muted">
                {t("editor.object")}
                <select
                  className={inputClass}
                  value={selectedObjectId ?? ""}
                  onChange={(e) => {
                    cancel();
                    onSelectObject(e.target.value || null);
                  }}
                >
                  <option value="">{t("editor.selectObject")}</option>
                  {manifest.scan.scene.objects.map((o, i) => (
                    <option key={o.id} value={o.id}>
                      {t(`editor.categories.${o.category}`, {
                        defaultValue: o.category,
                      })}{" "}
                      {i + 1} ·{" "}
                      {o.dimensions.map((n) => n.toFixed(2)).join(" × ")} m
                    </option>
                  ))}
                </select>
              </label>
              {object ? (
                <>
                  <RoomFurniturePicker
                      category={object.category}
                      value={object.appearance?.variant ?? null}
                      onChange={(variant) =>
                        changeObject({
                          ...object,
                          appearance: {
                            color: object.appearance?.color ?? null,
                            variant,
                          },
                        })
                      }
                    />
                  <label className="flex items-center justify-between text-xs text-muted">
                    {t("editor.color")}
                    <input
                      type="color"
                      aria-label={t("editor.color")}
                      value={object.appearance?.color ?? "#b29574"}
                      onChange={(e) =>
                        changeObject({
                          ...object,
                          appearance: {
                            variant: object.appearance?.variant ?? null,
                            color: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {["X", "Y", "Z"].map((label, a) => (
                      <div key={label}>
                        {numeric(
                          `${label} (m)`,
                          Math.round(object.transform[12 + a]! * 100) / 100,
                          (n) => {
                            const transform = [...object.transform];
                            transform[12 + a] = n;
                            changeObject({ ...object, transform });
                          },
                          -10000,
                          10000,
                          0.05,
                        )}
                      </div>
                    ))}
                  </div>
                  {numeric(
                    t("editor.rotation"),
                    Math.round(
                      (Math.atan2(object.transform[8]!, object.transform[0]!) *
                        180) /
                        Math.PI,
                    ),
                    (n) => {
                      const angle = (n * Math.PI) / 180;
                      const transform = [
                        Math.cos(angle),
                        0,
                        -Math.sin(angle),
                        0,
                        0,
                        1,
                        0,
                        0,
                        Math.sin(angle),
                        0,
                        Math.cos(angle),
                        0,
                        ...object.transform.slice(12),
                      ];
                      changeObject({ ...object, transform });
                    },
                    -180,
                    180,
                    1,
                  )}
                  <button
                    type="button"
                    className="text-xs text-brand"
                    onClick={() =>
                      changeObject({
                        ...object,
                        appearance: { variant: null, color: null },
                      })
                    }
                  >
                    {t("editor.resetModel")}
                  </button>
                  {saveButton(
                    () =>
                      void save({
                        action: "object",
                        revision,
                        objectId: object.id,
                        appearance: object.appearance ?? {
                          variant: null,
                          color: null,
                        },
                        transform: object.transform,
                      }),
                    !draft,
                  )}
                </>
              ) : null}
            </>
          ) : null}
          {tab === "map" ? (
            <>
              <p className="text-xs text-muted">{t("editor.mapHint")}</p>
              <AnchorPicker
                scene={manifest.scan.scene}
                layoutTransform={manifest.scan.layoutTransform}
                latitude={latitude}
                longitude={longitude}
                heading={heading}
                onChange={(lat, lng) => {
                  setLatitude(lat);
                  setLongitude(lng);
                }}
              />
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-muted">
                  {t("editor.latitude")}
                  <input
                    aria-label={t("editor.latitude")}
                    className={inputClass}
                    type="number"
                    step="0.000001"
                    min={-85}
                    max={85}
                    value={latitude ?? ""}
                    onChange={(e) =>
                      setLatitude(
                        Number.isFinite(e.target.valueAsNumber)
                          ? e.target.valueAsNumber
                          : null,
                      )
                    }
                  />
                </label>
                <label className="text-xs text-muted">
                  {t("editor.longitude")}
                  <input
                    aria-label={t("editor.longitude")}
                    className={inputClass}
                    type="number"
                    step="0.000001"
                    min={-180}
                    max={180}
                    value={longitude ?? ""}
                    onChange={(e) =>
                      setLongitude(
                        Number.isFinite(e.target.valueAsNumber)
                          ? e.target.valueAsNumber
                          : null,
                      )
                    }
                  />
                </label>
              </div>
              {numeric(t("editor.heading"), heading, setHeading, 0, 359, 1)}
              <input
                className="w-full"
                aria-label={t("editor.heading")}
                type="range"
                min={0}
                max={359}
                step={1}
                value={heading}
                onChange={(e) => setHeading(Number(e.target.value))}
              />
              {saveButton(
                () => {
                  if (latitude === null || longitude === null) return;
                  void save({
                    action: "anchor",
                    revision,
                    anchor: {
                      latitude,
                      longitude,
                      headingDegrees: heading,
                      source: "manual",
                      capturedAt: new Date().toISOString(),
                      localReferencePosition: centerPosition,
                    },
                  });
                },
                latitude === null ||
                  longitude === null ||
                  Math.abs(latitude) > 85 ||
                  Math.abs(longitude) > 180,
              )}
            </>
          ) : null}
          {tab === "rooms" ? (
            <>
              <label className="block text-xs text-muted">
                {t("editor.roomName")}
                <input
                  className={inputClass}
                  value={name}
                  maxLength={240}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                {numeric(t("editor.width"), width, setWidth, 0.8, 50)}
                {numeric(t("editor.depth"), depth, setDepth, 0.8, 50)}
                {numeric(t("editor.height"), height, setHeight, 1.8, 10)}
              </div>
              {saveButton(
                () =>
                  void save({
                    action: "add",
                    revision,
                    name,
                    width,
                    depth,
                    height,
                  }),
                !name.trim(),
                t("editor.add"),
              )}
              <div className="border-t border-border pt-3">
                <p className="mb-2 text-xs text-muted">
                  {t("editor.splitHint")}
                </p>
                <label className="block text-xs text-muted">
                  {t("editor.axis")}
                  <select
                    className={inputClass}
                    value={axis}
                    onChange={(e) => setAxis(e.target.value as "x" | "z")}
                  >
                    <option value="x">X</option>
                    <option value="z">Z</option>
                  </select>
                </label>
                <label className="my-2 block text-xs text-muted">
                  {t("editor.splitPosition", {
                    value: Math.round(ratio * 100),
                  })}
                  <input
                    className="w-full"
                    type="range"
                    min={10}
                    max={90}
                    value={ratio * 100}
                    onChange={(e) => setRatio(Number(e.target.value) / 100)}
                  />
                </label>
                {saveButton(
                  () => {
                    const a = axis === "x" ? 0 : 2;
                    const bounds = manifest.scan.scene.bounds;
                    void save({
                      action: "split",
                      revision,
                      name,
                      axis,
                      position:
                        bounds.min[a] + ratio * (bounds.max[a] - bounds.min[a]),
                    });
                  },
                  !name.trim(),
                  t("editor.split"),
                )}
              </div>
            </>
          ) : null}
          {tab === "scan" ? (
            <>
              <p className="text-xs text-muted">{t("editor.scanHint")}</p>
              <label className="block text-xs text-muted">
                {t("editor.import")}
                <input
                  className="mt-2 block w-full text-xs"
                  type="file"
                  accept=".json,application/json"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      if (file.size > 2_000_000) throw new Error();
                      const value = roomSceneSchema.parse(
                        JSON.parse(await file.text()),
                      );
                      setReplacement(value);
                      onPreview(value);
                      setError(null);
                    } catch {
                      setError(t("editor.errors.invalid-edit"));
                    }
                  }}
                />
              </label>
              {replacement ? (
                <p className="text-xs text-muted">
                  {t("editor.importPreview", {
                    surfaces: replacement.surfaces.length,
                    objects: replacement.objects.length,
                  })}
                </p>
              ) : null}
              {saveButton(() => {
                if (replacement)
                  void save({
                    action: "replace",
                    revision,
                    scene: replacement,
                  });
              }, !replacement)}
            </>
          ) : null}
          {draft || replacement ? (
            <button
              type="button"
              disabled={busy}
              className="flex items-center gap-1 text-xs text-muted"
              onClick={cancel}
            >
              <X className="size-3" />
              {t("editor.cancel")}
            </button>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="text-xs text-brand">
              {notice}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
