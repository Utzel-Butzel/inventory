"use client";

import dynamic from "next/dynamic";
import {
  OrganizationLink as Link,
  useOrganizationHref,
} from "@/components/organization-routing";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "next-i18next/client";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  Boxes,
  CalendarClock,
  ChevronRight,
  Download,
  LoaderCircle,
  MapPin,
  PackageOpen,
  Rotate3d,
  Search,
  Smartphone,
  Building2,
  Check,
  Layers3,
  Map as MapIcon,
  Move3d,
  RotateCcw,
  Save,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/components/ui";
import { floorIdentifier } from "@/lib/spatial-map-features";
import {
  arrangeFloorRooms,
  rotateRoomTransform,
  translateRoomTransform,
} from "@/lib/room-floor-layout";
import type { SpatialMatrix4 } from "@/lib/room-scene-contract";
import type {
  RoomAiAnalysis,
  RoomObjectSuggestion,
} from "@/lib/room-ai-analysis-contract";
import {
  fetchJson,
  type ClientRoomPlacement,
  type ClientRoomScanSummary,
  type ClientRoomSceneManifest,
  type ClientSpatialStructureDetail,
  type ClientSpatialStructureSummary,
} from "@/lib/client-types";

function RoomSceneLoading() {
  const { t } = useT("spatial");
  return (
    <div
      className="absolute inset-0 grid place-items-center bg-surface-muted text-muted"
      role="status"
      aria-label={t("rooms.loading")}
    >
      <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
    </div>
  );
}

const RoomSceneCanvas = dynamic(
  () =>
    import("@/components/room-scene-canvas").then(
      (module) => module.RoomSceneCanvas,
    ),
  {
    ssr: false,
    loading: () => <RoomSceneLoading />,
  },
);

const RoomLayoutMapCanvas = dynamic(
  () =>
    import("@/components/room-layout-map-canvas").then(
      (module) => module.RoomLayoutMapCanvas,
    ),
  {
    ssr: false,
    loading: () => <RoomSceneLoading />,
  },
);

const formatDate = (value: string, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export function RoomSceneBrowser() {
  const { t, i18n } = useT("spatial");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const integer = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const coordinate = useMemo(
    () => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [locale],
  );
  const router = useRouter();
  const organizationHref = useOrganizationHref();
  const searchParams = useSearchParams();
  const [scans, setScans] = useState<ClientRoomScanSummary[]>([]);
  const [manifest, setManifest] = useState<ClientRoomSceneManifest | null>(null);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loadingScans, setLoadingScans] = useState(true);
  const [loadingScene, setLoadingScene] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [structures, setStructures] = useState<ClientSpatialStructureSummary[]>([]);
  const [structureDetail, setStructureDetail] = useState<ClientSpatialStructureDetail | null>(null);
  const [selectedStructureId, setSelectedStructureId] = useState<string | null>(null);
  const [selectedFloorIdentifier, setSelectedFloorIdentifier] = useState<string | null>(null);
  const [layoutDrafts, setLayoutDrafts] = useState<Record<string, SpatialMatrix4> | null>(null);
  const [layoutRoomId, setLayoutRoomId] = useState<string | null>(null);
  const [layoutMapEnabled, setLayoutMapEnabled] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [analyzingRoom, setAnalyzingRoom] = useState(false);
  const [updatingSuggestionId, setUpdatingSuggestionId] = useState<string | null>(null);
  const sceneRequestRef = useRef(0);

  const updateUrl = useCallback(
    (scanId: string | null, resourceId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (scanId) params.set("room", scanId);
      else params.delete("room");
      if (resourceId) params.set("resource", resourceId);
      else params.delete("resource");
      const suffix = params.toString();
      router.replace(
        organizationHref(suffix ? `/spaces?${suffix}` : "/spaces"),
        { scroll: false },
      );
    },
    [organizationHref, router, searchParams],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoadingScans(true);
    setError(null);
    void fetchJson<{ scans: ClientRoomScanSummary[] }>("/api/v1/room-scans", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(({ scans: loaded }) => {
        setScans(loaded);
      })
      .catch((loadError) => {
        if ((loadError as Error).name !== "AbortError") {
          setError(t("rooms.errors.loadRooms"));
        }
      })
      .finally(() => setLoadingScans(false));
    return () => controller.abort();
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<{ structures: ClientSpatialStructureSummary[] }>(
      "/api/v1/spatial-structures",
      { cache: "no-store", signal: controller.signal },
    )
      .then(({ structures: loaded }) => setStructures(loaded))
      .catch(() => {
        // Legacy servers continue with the flat room-scan list.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const requestedStructureId = searchParams.get("structure");
    if (requestedStructureId && structures.some((item) => item.id === requestedStructureId)) {
      setSelectedStructureId(requestedStructureId);
      return;
    }
    const requestedRoomId = searchParams.get("room");
    const requestedRoom = scans.find((scan) => scan.id === requestedRoomId);
    if (
      !requestedStructureId &&
      requestedRoom?.structureId &&
      structures.some((item) => item.id === requestedRoom.structureId)
    ) {
      setSelectedStructureId(requestedRoom.structureId);
    }
  }, [scans, searchParams, structures]);

  useEffect(() => {
    if (!selectedStructureId) {
      setStructureDetail(null);
      setSelectedFloorIdentifier(null);
      return;
    }
    const controller = new AbortController();
    void fetchJson<{ structure: ClientSpatialStructureDetail }>(
      `/api/v1/spatial-structures/${encodeURIComponent(selectedStructureId)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(({ structure }) => {
        setStructureDetail(structure);
        const requestedFloor = searchParams.get("floor");
        const requestedScan = searchParams.get("room");
        const roomFloor = requestedScan
          ? structure.floors.find((candidate) =>
              candidate.rooms.some((room) => room.scan?.id === requestedScan),
            )
          : null;
        const floor = roomFloor ?? structure.floors.find(
          (candidate) => floorIdentifier(candidate.identifier, candidate.index) === requestedFloor,
        )
          ?? structure.floors[0]
          ?? null;
        setSelectedFloorIdentifier(
          floor ? floorIdentifier(floor.identifier, floor.index) : null,
        );
        const room = floor?.rooms.find((candidate) => candidate.scan?.id === requestedScan)
          ?? floor?.rooms.find((candidate) => candidate.scan)
          ?? null;
        if (room?.scan) setSelectedScanId(room.scan.id);
      })
      .catch(() => setStructureDetail(null));
    return () => controller.abort();
  }, [searchParams, selectedStructureId]);

  useEffect(() => {
    if (!scans.length) return;
    const requestedScanId = searchParams.get("room");
    const requestedScan =
      scans.find((scan) => scan.id === requestedScanId) ?? scans[0] ?? null;
    setSelectedScanId(requestedScan?.id ?? null);
    setSelectedResourceId(searchParams.get("resource"));
  }, [scans, searchParams]);

  useEffect(() => {
    const requestId = sceneRequestRef.current + 1;
    sceneRequestRef.current = requestId;
    if (!selectedScanId) {
      setManifest(null);
      setLoadingScene(false);
      return;
    }
    const controller = new AbortController();
    setLoadingScene(true);
    setManifest(null);
    setError(null);
    void fetchJson<{ scene: ClientRoomSceneManifest }>(
      `/api/v1/room-scans/${selectedScanId}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(({ scene }) => {
        if (controller.signal.aborted || sceneRequestRef.current !== requestId) return;
        setManifest(scene);
        setSelectedResourceId((current) =>
          current && scene.placements.some((item) => item.resource.id === current)
            ? current
            : null,
        );
      })
      .catch((loadError) => {
        if (
          !controller.signal.aborted &&
          sceneRequestRef.current === requestId &&
          (loadError as Error).name !== "AbortError"
        ) {
          setError(t("rooms.errors.loadScene"));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && sceneRequestRef.current === requestId) {
          setLoadingScene(false);
        }
      });
    return () => controller.abort();
  }, [selectedScanId, t]);

  const selectScan = (scanId: string) => {
    setSelectedScanId(scanId);
    setSelectedResourceId(null);
    updateUrl(scanId, null);
  };

  const selectStructure = (structureId: string | null) => {
    setSelectedStructureId(structureId);
    setSelectedFloorIdentifier(null);
    const params = new URLSearchParams(searchParams.toString());
    if (structureId) params.set("structure", structureId);
    else params.delete("structure");
    params.delete("floor");
    params.delete("room");
    params.delete("resource");
    const suffix = params.toString();
    router.replace(
      organizationHref(suffix ? `/spaces?${suffix}` : "/spaces"),
      { scroll: false },
    );
  };

  const selectFloor = (identifier: string) => {
    const floor = structureDetail?.floors.find(
      (candidate) => floorIdentifier(candidate.identifier, candidate.index) === identifier,
    );
    const scanId = floor?.rooms.find((room) => room.scan)?.scan?.id ?? null;
    setSelectedFloorIdentifier(identifier);
    if (scanId) {
      setSelectedScanId(scanId);
      setSelectedResourceId(null);
    }
    const params = new URLSearchParams(searchParams.toString());
    if (selectedStructureId) params.set("structure", selectedStructureId);
    params.set("floor", identifier);
    if (scanId) params.set("room", scanId);
    else params.delete("room");
    params.delete("resource");
    router.replace(organizationHref(`/spaces?${params.toString()}`), {
      scroll: false,
    });
  };

  const selectResource = useCallback(
    (resourceId: string) => {
      setSelectedResourceId(resourceId);
      updateUrl(selectedScanId, resourceId);
    },
    [selectedScanId, updateUrl],
  );

  const selectedFloor = useMemo(
    () => structureDetail?.floors.find(
      (floor) => floorIdentifier(floor.identifier, floor.index) === selectedFloorIdentifier,
    ) ?? null,
    [selectedFloorIdentifier, structureDetail],
  );
  const groupedScans = selectedFloor?.rooms.filter(
    (room): room is typeof room & { scan: NonNullable<typeof room.scan> } => Boolean(room.scan),
  ) ?? [];

  const floorManifests = useMemo<ClientRoomSceneManifest[]>(() => {
    if (!manifest || !selectedFloor) return manifest ? [manifest] : [];
    return selectedFloor.rooms.flatMap((room) => {
      if (!room.scan) return [];
      if (room.scan.id === manifest.scan.id) return [manifest];
      return [{
        room: {
          id: room.roomResourceId,
          name: room.roomName,
          description: "",
        },
        scan: room.scan,
        placements: room.placements,
        structureId: structureDetail?.id ?? manifest.structureId,
        structureName: structureDetail?.name ?? manifest.structureName,
        floorIdentifier: selectedFloor.identifier,
        floorIndex: selectedFloor.index,
        roomIdentifier: room.roomIdentifier,
        coordinateSpaceId: room.scan.coordinateSpaceId ?? room.coordinateSpaceId,
        georeference: room.georeference,
      }];
    });
  }, [manifest, selectedFloor, structureDetail]);

  const automaticLayout = useMemo(
    () => arrangeFloorRooms(floorManifests.map((item) => ({
      id: item.scan.id,
      coordinateSpaceId: item.scan.coordinateSpaceId,
      bounds: item.scan.scene.bounds,
      worldFromModel: item.scan.scene.worldFromModel,
      layoutTransform: item.scan.layoutTransform,
    }))),
    [floorManifests],
  );
  const effectiveTransforms = useMemo(() => {
    const transforms = new Map(automaticLayout.transforms);
    if (layoutDrafts) {
      for (const [scanId, transform] of Object.entries(layoutDrafts)) {
        transforms.set(scanId, transform);
      }
    }
    return transforms;
  }, [automaticLayout, layoutDrafts]);
  const layoutMapFallbackGeoreference = structureDetail?.georeference ?? null;
  const hasLayoutMapAnchor = floorManifests.some(
    (item) => Boolean(item.scan.georeference ?? item.georeference),
  ) || Boolean(layoutMapFallbackGeoreference);
  const visibleManifests = useMemo(
    () => floorManifests.map((item) => ({
      ...item,
      scan: {
        ...item.scan,
        layoutTransform:
          effectiveTransforms.get(item.scan.id) ?? item.scan.layoutTransform ?? null,
      },
    })),
    [effectiveTransforms, floorManifests],
  );
  const visibleManifest = visibleManifests.find(
    (item) => item.scan.id === manifest?.scan.id,
  ) ?? manifest;
  const linkedManifests = visibleManifests.filter(
    (item) => item.scan.id !== visibleManifest?.scan.id,
  );

  const beginLayout = () => {
    setLayoutMapEnabled(false);
    setLayoutDrafts(Object.fromEntries(effectiveTransforms) as Record<string, SpatialMatrix4>);
    setLayoutRoomId(selectedScanId ?? floorManifests[0]?.scan.id ?? null);
  };
  const closeLayout = () => {
    setLayoutDrafts(null);
    setLayoutMapEnabled(false);
  };
  const setMapLayoutEnabled = (enabled: boolean) => {
    setLayoutMapEnabled(enabled);
    if (!enabled) return;
    // Exact room anchors start from their captured AR world transform. Rooms
    // using the broader building anchor keep the compact automatic layout so
    // every footprint is visible and can be aligned manually on the basemap.
    setLayoutDrafts(Object.fromEntries(floorManifests.map((item) => {
      const hasOwnGeoreference = Boolean(
        item.scan.georeference ?? item.georeference,
      );
      return [
        item.scan.id,
        item.scan.layoutTransform ?? (hasOwnGeoreference
          ? item.scan.scene.worldFromModel
          : effectiveTransforms.get(item.scan.id) ?? item.scan.scene.worldFromModel),
      ];
    })) as Record<string, SpatialMatrix4>);
  };
  const adjustRoomLayout = (
    scanId: string,
    change: (transform: SpatialMatrix4) => SpatialMatrix4,
  ) => {
    setLayoutDrafts((current) => {
      if (!current) return current;
      const transform = current[scanId] ?? effectiveTransforms.get(scanId);
      return transform ? { ...current, [scanId]: change(transform) } : current;
    });
  };
  const resetAutomaticLayout = () => {
    const reset = arrangeFloorRooms(floorManifests.map((item) => ({
      id: item.scan.id,
      coordinateSpaceId: item.scan.coordinateSpaceId,
      bounds: item.scan.scene.bounds,
      worldFromModel: item.scan.scene.worldFromModel,
      layoutTransform: null,
    })));
    if (layoutMapEnabled) {
      setLayoutDrafts(Object.fromEntries(floorManifests.map((item) => [
        item.scan.id,
        (item.scan.georeference ?? item.georeference)
          ? item.scan.scene.worldFromModel
          : reset.transforms.get(item.scan.id) ?? item.scan.scene.worldFromModel,
      ])) as Record<string, SpatialMatrix4>);
      return;
    }
    setLayoutDrafts(Object.fromEntries(reset.transforms) as Record<string, SpatialMatrix4>);
  };
  const saveLayout = async () => {
    if (!layoutDrafts) return;
    setSavingLayout(true);
    setError(null);
    try {
      await Promise.all(Object.entries(layoutDrafts).map(([scanId, transform]) =>
        fetchJson(`/api/v1/room-scans/${encodeURIComponent(scanId)}/layout`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ transform }),
        }),
      ));
      setManifest((current) => current
        ? {
            ...current,
            scan: {
              ...current.scan,
              layoutTransform: layoutDrafts[current.scan.id] ?? current.scan.layoutTransform,
            },
          }
        : current);
      setStructureDetail((current) => current
        ? {
            ...current,
            floors: current.floors.map((floor) => ({
              ...floor,
              rooms: floor.rooms.map((room) => room.scan
                ? {
                    ...room,
                    scan: {
                      ...room.scan,
                      layoutTransform:
                        layoutDrafts[room.scan.id] ?? room.scan.layoutTransform,
                    },
                  }
                : room),
            })),
          }
        : current);
      setLayoutDrafts(null);
      setLayoutMapEnabled(false);
    } catch {
      setError(t("rooms.errors.saveLayout"));
    } finally {
      setSavingLayout(false);
    }
  };

  const visiblePlacements = useMemo(
    () => [visibleManifest, ...linkedManifests].flatMap((item) => item?.placements ?? []),
    [linkedManifests, visibleManifest],
  );

  const placements = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    if (!normalized) return visiblePlacements;
    return visiblePlacements.filter(({ resource }) =>
      `${resource.name} ${resource.type} ${resource.status} ${resource.location ?? ""}`
        .toLocaleLowerCase(locale)
        .includes(normalized),
    );
  }, [locale, query, visiblePlacements]);

  const selectedPlacement = visiblePlacements.find(
    (placement) => placement.resource.id === selectedResourceId,
  ) ?? null;
  const modelAsset = visibleManifest?.scan.assets.find((asset) => asset.kind === "model_usdz");
  const selectedLayoutManifest = floorManifests.find(
    (item) => item.scan.id === layoutRoomId,
  ) ?? null;
  const roomAnalysis = visibleManifest?.scan.aiAnalysis ?? null;
  const visibleSuggestions = roomAnalysis?.objectSuggestions.filter(
    (suggestion) => suggestion.status !== "dismissed",
  ) ?? [];

  const setVisibleRoomAnalysis = useCallback((scanId: string, analysis: RoomAiAnalysis) => {
    setManifest((current) => current?.scan.id === scanId
      ? {
          ...current,
          scan: { ...current.scan, aiAnalysis: analysis },
        }
      : current);
  }, []);

  const analyzeRoom = async () => {
    if (!visibleManifest || analyzingRoom) return;
    setAnalyzingRoom(true);
    setError(null);
    try {
      const { analysis } = await fetchJson<{ analysis: RoomAiAnalysis }>(
        `/api/v1/room-scans/${encodeURIComponent(visibleManifest.scan.id)}/analysis`,
        {
          method: "POST",
        },
      );
      setVisibleRoomAnalysis(visibleManifest.scan.id, analysis);
    } catch {
      setError(t("rooms.errors.analyzeRoom"));
    } finally {
      setAnalyzingRoom(false);
    }
  };

  const reviewSuggestion = async (
    suggestion: RoomObjectSuggestion,
    status: RoomObjectSuggestion["status"],
  ) => {
    if (!visibleManifest || updatingSuggestionId) return;
    setUpdatingSuggestionId(suggestion.id);
    setError(null);
    try {
      const { analysis } = await fetchJson<{ analysis: RoomAiAnalysis }>(
        `/api/v1/room-scans/${encodeURIComponent(visibleManifest.scan.id)}/analysis`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ suggestionId: suggestion.id, status }),
        },
      );
      setVisibleRoomAnalysis(visibleManifest.scan.id, analysis);
    } catch {
      setError(t("rooms.errors.reviewSuggestion"));
    } finally {
      setUpdatingSuggestionId(null);
    }
  };

  if (loadingScans) {
    return (
      <div
        className="grid min-h-[calc(100dvh-68px)] place-items-center text-muted"
        role="status"
        aria-label={t("rooms.loading")}
      >
        <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  if (!scans.length) {
    return (
      <main className="mx-auto flex min-h-[calc(100dvh-68px)] max-w-4xl items-center px-5 py-14">
        <div className="w-full rounded-3xl border border-border bg-surface p-8 text-center shadow-sm sm:p-12">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand">
            <Rotate3d className="size-7" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">
            {t("rooms.empty.title")}
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">
            {t("rooms.empty.description")}
          </p>
          {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}
          <div className="mt-6 inline-flex items-center gap-2 rounded-xl bg-surface-muted px-4 py-2.5 text-xs font-semibold text-muted">
            <Smartphone className="size-4" aria-hidden="true" />
            {t("rooms.empty.requirement")}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[calc(100dvh-68px)] flex-col gap-4 px-3 py-4 sm:px-5 lg:px-6">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground sm:text-[28px]">
            {t("rooms.title")}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {t("rooms.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>
            {t("rooms.stats.rooms", {
              count: scans.length,
              value: integer.format(scans.length),
            })}
          </span>
          <span>
            {t("rooms.stats.items", {
              count: visiblePlacements.length,
              value: integer.format(visiblePlacements.length),
            })}
          </span>
          {linkedManifests.length ? (
            <span className="font-semibold text-success">
              {t("rooms.stats.linked", {
                count: linkedManifests.length + 1,
                value: integer.format(linkedManifests.length + 1),
              })}
            </span>
          ) : null}
        </div>
      </header>

      {structures.length || floorManifests.length ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-3 shadow-sm md:flex-row md:items-center">
          {structures.length ? (
            <label className="flex min-w-0 flex-1 items-center gap-2">
              <Building2 className="size-4 shrink-0 text-brand" aria-hidden="true" />
              <span className="sr-only">{t("rooms.structures.building")}</span>
              <select
                value={selectedStructureId ?? ""}
                onChange={(event) => selectStructure(event.target.value || null)}
                className="h-9 min-w-0 flex-1 rounded-xl border border-border bg-surface-subtle px-3 text-xs font-semibold text-muted-strong outline-none focus:border-focus focus:bg-surface"
              >
                <option value="">{t("rooms.structures.individualRooms")}</option>
                {structures.map((structure) => (
                  <option key={structure.id} value={structure.id}>
                    {structure.name} · {t("rooms.structures.summary", {
                      floors: t("rooms.structures.floors", {
                        count: structure.floorCount,
                        value: integer.format(structure.floorCount),
                      }),
                      rooms: t("rooms.structures.rooms", {
                        count: structure.roomCount,
                        value: integer.format(structure.roomCount),
                      }),
                    })}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2 px-1 text-xs font-semibold text-muted-strong">
              <Box className="size-4 shrink-0 text-brand" aria-hidden="true" />
              <span className="truncate">{visibleManifest?.room.name}</span>
            </div>
          )}
          {structureDetail?.floors.length ? (
            <div className="flex items-center gap-1.5 overflow-x-auto">
              <Layers3 className="mx-1 size-4 shrink-0 text-muted" aria-hidden="true" />
              {structureDetail.floors.map((floor) => (
                <button
                  key={`${floor.identifier ?? "unassigned"}:${floor.index ?? "none"}`}
                  type="button"
                  onClick={() => selectFloor(floorIdentifier(floor.identifier, floor.index))}
                  className={cn(
                    "shrink-0 rounded-xl px-3 py-2 text-[11px] font-semibold transition",
                    selectedFloorIdentifier === floorIdentifier(floor.identifier, floor.index)
                      ? "bg-brand-solid text-on-brand"
                      : "bg-surface-muted text-muted hover:bg-surface-hover",
                  )}
                >
                  {t("rooms.structures.floorRooms", {
                    floor: floorIdentifier(floor.identifier, floor.index),
                    count: floor.roomCount,
                    value: integer.format(floor.roomCount),
                  })}
                </button>
              ))}
            </div>
          ) : null}
          {selectedStructureId ? (
            <Link
              href={`/map?structure=${encodeURIComponent(selectedStructureId)}${selectedFloorIdentifier ? `&floor=${encodeURIComponent(selectedFloorIdentifier)}` : ""}`}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-border px-3 text-[11px] font-semibold text-muted hover:bg-surface-hover"
            >
              <MapIcon className="size-3.5" aria-hidden="true" /> {t("rooms.structures.viewMap")}
            </Link>
          ) : null}
          {floorManifests.length ? (
            <button
              type="button"
              onClick={layoutDrafts ? closeLayout : beginLayout}
              className={cn(
                "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-[11px] font-semibold transition",
                layoutDrafts
                  ? "border-brand-border bg-brand-soft text-brand-strong"
                  : "border-border text-muted hover:bg-surface-hover",
              )}
              aria-pressed={Boolean(layoutDrafts)}
            >
              <Move3d className="size-3.5" aria-hidden="true" />
              {layoutDrafts ? t("rooms.layout.close") : t("rooms.layout.open")}
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="grid min-h-[680px] flex-1 overflow-hidden rounded-xl border border-border bg-surface lg:grid-cols-[280px_minmax(0,1fr)_300px]">
        <aside className="order-2 border-t border-border bg-surface-subtle p-3 lg:order-1 lg:border-r lg:border-t-0">
          <p className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted">
            {t("rooms.scans.title")}
          </p>
          <div className="space-y-1">
            {(selectedStructureId && groupedScans.length
              ? groupedScans.map(({ scan, roomName }) => ({
                  id: scan.id,
                  roomName,
                  revision: scan.revision,
                  placementCount: selectedFloor?.rooms.find((room) => room.scan?.id === scan.id)?.placements.length ?? 0,
                  coordinateSpaceId: scan.coordinateSpaceId,
                }))
              : scans
            ).map((scan) => {
              const active = scan.id === selectedScanId;
              return (
                <button
                  key={scan.id}
                  type="button"
                  onClick={() => selectScan(scan.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition",
                    active
                      ? "bg-brand-soft text-brand-strong"
                      : "text-muted-strong hover:bg-surface-hover",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-xl",
                      active ? "bg-brand-solid text-on-brand" : "bg-surface text-muted shadow-sm",
                    )}
                  >
                    <Box className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{scan.roomName}</span>
                    <span className="mt-0.5 block text-[11px] text-muted">
                      {t("rooms.scans.revision", {
                        revision: integer.format(scan.revision),
                        count: scan.placementCount,
                        value: integer.format(scan.placementCount),
                      })}
                    </span>
                    {scan.coordinateSpaceId ? (
                      <span className="mt-0.5 block truncate text-[9px] text-muted">
                        {t("rooms.scans.sharedFrame", {
                          id: scan.coordinateSpaceId.slice(0, 8),
                        })}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight className="size-4 shrink-0 opacity-45" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </aside>

        <section className="relative order-1 min-h-[430px] overflow-hidden bg-surface-muted lg:order-2">
          {layoutDrafts && layoutMapEnabled ? (
            <RoomLayoutMapCanvas
              manifests={visibleManifests}
              fallbackGeoreference={layoutMapFallbackGeoreference}
              selectedScanId={layoutRoomId}
              onSelectRoom={setLayoutRoomId}
              onChangeTransform={(scanId, transform) => {
                setLayoutDrafts((current) => current
                  ? { ...current, [scanId]: transform }
                  : current);
              }}
            />
          ) : visibleManifest && !loadingScene ? (
            <RoomSceneCanvas
              manifest={visibleManifest}
              linkedManifests={linkedManifests}
              selectedResourceId={selectedResourceId}
              onSelectResource={selectResource}
            />
          ) : (
            <div
              className="absolute inset-0 grid place-items-center text-muted"
              role="status"
              aria-label={t("rooms.loading")}
            >
              <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
            </div>
          )}

          {layoutDrafts && selectedLayoutManifest ? (
            <div className="absolute right-3 top-14 z-20 w-[min(310px,calc(100%-24px))] rounded-xl border border-border bg-surface p-3 shadow-lg">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    {t("rooms.layout.title")}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted">
                    {t("rooms.layout.description")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetAutomaticLayout}
                  className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-muted hover:text-brand"
                  title={t(layoutMapEnabled
                    ? "rooms.layout.mapAutomatic"
                    : "rooms.layout.automatic")}
                  aria-label={t(layoutMapEnabled
                    ? "rooms.layout.mapAutomatic"
                    : "rooms.layout.automatic")}
                >
                  <Undo2 className="size-3.5" aria-hidden="true" />
                </button>
              </div>
              <select
                value={selectedLayoutManifest.scan.id}
                onChange={(event) => setLayoutRoomId(event.target.value)}
                className="mt-3 h-9 w-full rounded-xl border border-border bg-surface-subtle px-3 text-xs font-semibold text-foreground outline-none focus:border-focus"
                aria-label={t("rooms.layout.room")}
              >
                {floorManifests.map((item) => (
                  <option key={item.scan.id} value={item.scan.id}>
                    {item.room.name}
                  </option>
                ))}
              </select>
              <label className="mt-3 flex items-start gap-2.5 rounded-xl border border-border bg-surface-subtle p-2.5 text-left">
                <input
                  type="checkbox"
                  checked={layoutMapEnabled}
                  onChange={(event) => setMapLayoutEnabled(event.target.checked)}
                  disabled={!hasLayoutMapAnchor}
                  className="mt-0.5 size-4 shrink-0 accent-brand-solid disabled:opacity-50"
                />
                <span>
                  <span className="block text-[11px] font-semibold text-foreground">
                    {t("rooms.layout.mapBackground")}
                  </span>
                  <span className="mt-0.5 block text-[9px] leading-4 text-muted">
                    {hasLayoutMapAnchor
                      ? t("rooms.layout.mapHint")
                      : t("rooms.layout.mapUnavailable")}
                  </span>
                </span>
              </label>
              <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <button
                  type="button"
                  onClick={() => adjustRoomLayout(selectedLayoutManifest.scan.id, (matrix) =>
                    rotateRoomTransform(matrix, -Math.PI / 36))}
                  className="inline-flex h-9 items-center justify-center gap-1 rounded-xl border border-border text-[10px] font-semibold text-muted hover:text-brand"
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" /> -5°
                </button>
                <div className="grid grid-cols-3 gap-1">
                  <span />
                  <button
                    type="button"
                    onClick={() => adjustRoomLayout(selectedLayoutManifest.scan.id, (matrix) =>
                      translateRoomTransform(matrix, [0, 0, -0.25]))}
                    className="grid size-8 place-items-center rounded-lg bg-surface-muted text-muted hover:text-brand"
                    aria-label={t("rooms.layout.forward")}
                  >
                    <ArrowUp className="size-3.5" aria-hidden="true" />
                  </button>
                  <span />
                  <button
                    type="button"
                    onClick={() => adjustRoomLayout(selectedLayoutManifest.scan.id, (matrix) =>
                      translateRoomTransform(matrix, [-0.25, 0, 0]))}
                    className="grid size-8 place-items-center rounded-lg bg-surface-muted text-muted hover:text-brand"
                    aria-label={t("rooms.layout.left")}
                  >
                    <ArrowLeft className="size-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => adjustRoomLayout(selectedLayoutManifest.scan.id, (matrix) =>
                      translateRoomTransform(matrix, [0, 0, 0.25]))}
                    className="grid size-8 place-items-center rounded-lg bg-surface-muted text-muted hover:text-brand"
                    aria-label={t("rooms.layout.backward")}
                  >
                    <ArrowDown className="size-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => adjustRoomLayout(selectedLayoutManifest.scan.id, (matrix) =>
                      translateRoomTransform(matrix, [0.25, 0, 0]))}
                    className="grid size-8 place-items-center rounded-lg bg-surface-muted text-muted hover:text-brand"
                    aria-label={t("rooms.layout.right")}
                  >
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => adjustRoomLayout(selectedLayoutManifest.scan.id, (matrix) =>
                    rotateRoomTransform(matrix, Math.PI / 36))}
                  className="inline-flex h-9 items-center justify-center gap-1 rounded-xl border border-border text-[10px] font-semibold text-muted hover:text-brand"
                >
                  +5° <RotateCcw className="size-3.5 scale-x-[-1]" aria-hidden="true" />
                </button>
              </div>
              <p className="mt-2 text-center text-[9px] text-muted">
                {layoutMapEnabled
                  ? t("rooms.layout.mapStep")
                  : t("rooms.layout.step")}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={closeLayout}
                  disabled={savingLayout}
                  className="h-9 flex-1 rounded-xl border border-border text-[11px] font-semibold text-muted hover:bg-surface-hover disabled:opacity-50"
                >
                  {t("rooms.layout.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void saveLayout()}
                  disabled={savingLayout}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-solid text-[11px] font-semibold text-on-brand disabled:opacity-50"
                >
                  {savingLayout ? (
                    <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="size-3.5" aria-hidden="true" />
                  )}
                  {t("rooms.layout.save")}
                </button>
              </div>
            </div>
          ) : null}

          {selectedPlacement ? (
            <SelectedPlacementCard placement={selectedPlacement} />
          ) : null}

          {visibleManifest && !visiblePlacements.length ? (
            <div className="absolute inset-x-4 bottom-14 mx-auto max-w-md rounded-xl border border-border bg-surface p-4 text-center shadow-lg">
              <MapPin className="mx-auto size-5 text-brand" aria-hidden="true" />
              <p className="mt-2 text-sm font-semibold text-foreground">{t("rooms.scene.noItemsTitle")}</p>
              <p className="mt-1 text-xs leading-5 text-muted">
                {t("rooms.scene.noItemsDescription")}
              </p>
            </div>
          ) : null}
        </section>

        <aside className="order-3 flex min-h-0 flex-col border-t border-border bg-surface lg:border-l lg:border-t-0">
          <div className="border-b border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-foreground">
                  {visibleManifest?.room.name ?? t("rooms.scene.roomFallback")}
                </h2>
                {visibleManifest ? (
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
                    <CalendarClock className="size-3.5" aria-hidden="true" />
                    {formatDate(visibleManifest.scan.capturedAt, locale)}
                  </p>
                ) : null}
              </div>
              {modelAsset ? (
                <a
                  href={modelAsset.url}
                  className="grid size-9 shrink-0 place-items-center rounded-xl border border-border text-muted transition hover:border-brand-border hover:text-brand"
                  title={t("rooms.scene.downloadUsdz")}
                  aria-label={t("rooms.scene.downloadUsdz")}
                >
                  <Download className="size-4" aria-hidden="true" />
                </a>
              ) : null}
            </div>
            {visibleManifest ? (
              <button
                type="button"
                onClick={() => void analyzeRoom()}
                disabled={
                  analyzingRoom || !(visibleManifest.scan.keyframes?.length ?? 0)
                }
                className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-brand-solid px-3 text-[11px] font-semibold text-on-brand transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {analyzingRoom ? (
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="size-3.5" aria-hidden="true" />
                )}
                {analyzingRoom
                  ? t("rooms.ai.analyzing")
                  : roomAnalysis
                    ? t("rooms.ai.refresh")
                    : t("rooms.ai.analyze")}
              </button>
            ) : null}
            <label className="relative mt-3 block">
              <span className="sr-only">{t("rooms.placements.searchPlaceholder")}</span>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("rooms.placements.searchPlaceholder")}
                className="h-9 w-full rounded-xl border border-border bg-surface-subtle pl-9 pr-3 text-xs text-foreground outline-none transition focus:border-focus focus:bg-surface focus:ring-4 focus:ring-focus/10"
              />
            </label>
          </div>

          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
            {roomAnalysis ? (
              <section className="mb-2 rounded-xl border border-brand-border bg-brand-soft/45 p-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
                  <h3 className="text-[11px] font-semibold text-foreground">
                    {t("rooms.ai.title")}
                  </h3>
                </div>
                <p className="mt-2 text-[10px] leading-4 text-muted">
                  {roomAnalysis.summary}
                </p>

                {roomAnalysis.surfaceAppearances.length ? (
                  <div className="mt-3">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted">
                      {t("rooms.ai.finishes")}
                    </p>
                    <div className="mt-1.5 space-y-1">
                      {roomAnalysis.surfaceAppearances.map((appearance) => (
                        <div
                          key={appearance.surfaceCategory}
                          className="flex items-center gap-2 rounded-lg bg-surface/75 px-2 py-1.5"
                        >
                          <span
                            className="size-5 shrink-0 rounded-md border border-border shadow-inner"
                            style={{ backgroundColor: appearance.colorHex }}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[10px] font-semibold text-foreground">
                              {t(`rooms.ai.surfaces.${appearance.surfaceCategory}`)} · {appearance.colorName}
                            </span>
                            <span className="block truncate text-[9px] text-muted">
                              {t(`rooms.ai.materials.${appearance.material}`)} · {t("rooms.ai.confidence", {
                                value: integer.format(Math.round(appearance.confidence * 100)),
                              })}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mt-3 flex items-center justify-between gap-2">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted">
                    {t("rooms.ai.suggestions")}
                  </p>
                  <span className="text-[9px] text-muted">
                    {integer.format(visibleSuggestions.length)}
                  </span>
                </div>
                {visibleSuggestions.length ? (
                  <div className="mt-1.5 space-y-1.5">
                    {visibleSuggestions.map((suggestion) => {
                      const updating = updatingSuggestionId === suggestion.id;
                      return (
                        <article
                          key={suggestion.id}
                          className="rounded-lg border border-border bg-surface/85 p-2"
                        >
                          <div className="flex items-start gap-2">
                            {suggestion.colorHex ? (
                              <span
                                className="mt-0.5 size-5 shrink-0 rounded-md border border-border"
                                style={{ backgroundColor: suggestion.colorHex }}
                                aria-hidden="true"
                              />
                            ) : (
                              <PackageOpen className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[10px] font-semibold text-foreground">
                                {suggestion.name}
                              </p>
                              <p className="mt-0.5 text-[9px] leading-4 text-muted">
                                {suggestion.evidence}
                              </p>
                              <p className="mt-1 text-[9px] font-medium text-muted-strong">
                                {suggestion.roomObjectId
                                  ? t("rooms.ai.grounded")
                                  : t("rooms.ai.unplaced")}
                              </p>
                            </div>
                          </div>
                          <div className="mt-2 flex gap-1.5">
                            {suggestion.status === "pending" ? (
                              <button
                                type="button"
                                onClick={() => void reviewSuggestion(suggestion, "accepted")}
                                disabled={Boolean(updatingSuggestionId)}
                                className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-lg bg-success-soft text-[9px] font-semibold text-success disabled:opacity-50"
                              >
                                {updating ? (
                                  <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
                                ) : (
                                  <Check className="size-3" aria-hidden="true" />
                                )}
                                {t("rooms.ai.accept")}
                              </button>
                            ) : (
                              <span className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-lg bg-success-soft text-[9px] font-semibold text-success">
                                <Check className="size-3" aria-hidden="true" />
                                {t("rooms.ai.accepted")}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => void reviewSuggestion(suggestion, "dismissed")}
                              disabled={Boolean(updatingSuggestionId)}
                              className="grid size-7 place-items-center rounded-lg border border-border text-muted hover:text-danger disabled:opacity-50"
                              aria-label={t("rooms.ai.dismiss", { name: suggestion.name })}
                              title={t("rooms.ai.dismiss", { name: suggestion.name })}
                            >
                              <X className="size-3" aria-hidden="true" />
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-1.5 text-[10px] leading-4 text-muted">
                    {t("rooms.ai.noSuggestions")}
                  </p>
                )}
                <p className="mt-2 text-[9px] leading-4 text-muted">
                  {t("rooms.ai.reviewHint")}
                </p>
              </section>
            ) : null}
            {placements.length ? (
              <div className="space-y-1">
                {placements.map((placement) => {
                  const active = placement.resource.id === selectedResourceId;
                  return (
                    <button
                      key={placement.id}
                      type="button"
                      onClick={() => selectResource(placement.resource.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition",
                        active ? "bg-warning-soft" : "hover:bg-surface-hover",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-xl",
                          active
                            ? "bg-warning text-on-strong"
                            : "bg-brand-soft text-brand",
                        )}
                      >
                        <PackageOpen className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-foreground">
                          {placement.resource.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted">
                          {t("rooms.placements.coordinates", {
                            coordinates: placement.position
                              .map((value) => coordinate.format(value))
                              .join(" · "),
                          })}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-muted">
                <Boxes className="mx-auto mb-2 size-5" aria-hidden="true" />
                {t("rooms.placements.noMatches")}
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function SelectedPlacementCard({ placement }: { placement: ClientRoomPlacement }) {
  const { t, i18n } = useT("spatial");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const percent = useMemo(
    () => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }),
    [locale],
  );
  const method = t(`rooms.placements.methods.${placement.method}`, {
    defaultValue: placement.method,
  });

  return (
    <div className="absolute bottom-12 left-3 z-10 w-[min(330px,calc(100%-24px))] rounded-2xl border border-border bg-surface/92 p-3 shadow-xl backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-warning-soft text-warning">
          {placement.resource.cover ? (
            // Same-origin media URLs carry the active session cookie.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={placement.resource.cover.url}
              alt={placement.resource.cover.altText || placement.resource.name}
              className="size-full object-cover"
            />
          ) : (
            <PackageOpen className="size-5" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {placement.resource.name}
          </p>
          <p className="mt-0.5 text-[10px] text-muted">
            {t("rooms.placements.accuracy", {
              value: percent.format(placement.confidence),
              method,
            })}
          </p>
        </div>
        <Link
          href={`/inventory/${placement.resource.id}`}
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-solid text-on-brand transition hover:bg-brand-hover"
          aria-label={t("rooms.placements.open", { name: placement.resource.name })}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
