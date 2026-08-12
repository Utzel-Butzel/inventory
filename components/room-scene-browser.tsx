"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
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
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/components/ui";
import {
  fetchJson,
  type ClientRoomPlacement,
  type ClientRoomScanSummary,
  type ClientRoomSceneManifest,
} from "@/lib/client-types";

const RoomSceneCanvas = dynamic(
  () =>
    import("@/components/room-scene-canvas").then(
      (module) => module.RoomSceneCanvas,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 grid place-items-center bg-[#f3f5f7] text-slate-400">
        <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
      </div>
    ),
  },
);

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export function RoomSceneBrowser() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [scans, setScans] = useState<ClientRoomScanSummary[]>([]);
  const [manifest, setManifest] = useState<ClientRoomSceneManifest | null>(null);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loadingScans, setLoadingScans] = useState(true);
  const [loadingScene, setLoadingScene] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sceneRequestRef = useRef(0);

  const updateUrl = useCallback(
    (scanId: string | null, resourceId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (scanId) params.set("room", scanId);
      else params.delete("room");
      if (resourceId) params.set("resource", resourceId);
      else params.delete("resource");
      const suffix = params.toString();
      router.replace(suffix ? `/spaces?${suffix}` : "/spaces", { scroll: false });
    },
    [router, searchParams],
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
          setError(loadError instanceof Error ? loadError.message : "Unable to load rooms.");
        }
      })
      .finally(() => setLoadingScans(false));
    return () => controller.abort();
  }, []);

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
          setError(loadError instanceof Error ? loadError.message : "Unable to load room scene.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && sceneRequestRef.current === requestId) {
          setLoadingScene(false);
        }
      });
    return () => controller.abort();
  }, [selectedScanId]);

  const selectScan = (scanId: string) => {
    setSelectedScanId(scanId);
    setSelectedResourceId(null);
    updateUrl(scanId, null);
  };

  const selectResource = useCallback(
    (resourceId: string) => {
      setSelectedResourceId(resourceId);
      updateUrl(selectedScanId, resourceId);
    },
    [selectedScanId, updateUrl],
  );

  const placements = useMemo(() => {
    if (!manifest) return [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return manifest.placements;
    return manifest.placements.filter(({ resource }) =>
      `${resource.name} ${resource.type} ${resource.status} ${resource.location ?? ""}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [manifest, query]);

  const selectedPlacement = manifest?.placements.find(
    (placement) => placement.resource.id === selectedResourceId,
  ) ?? null;
  const modelAsset = manifest?.scan.assets.find((asset) => asset.kind === "model_usdz");

  if (loadingScans) {
    return (
      <div className="grid min-h-[calc(100dvh-68px)] place-items-center text-slate-400">
        <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  if (!scans.length) {
    return (
      <main className="mx-auto flex min-h-[calc(100dvh-68px)] max-w-4xl items-center px-5 py-14">
        <div className="w-full rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-12">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-violet-100 text-violet-600">
            <Rotate3d className="size-7" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-900">
            No rooms have been scanned yet
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
            Open the Inventory iPhone app, choose Rooms, and scan a room with RoomPlan.
            Its 3D model and every spatially captured inventory item will appear here.
          </p>
          {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
          <div className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-600">
            <Smartphone className="size-4" aria-hidden="true" />
            Requires a LiDAR-capable iPhone
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[calc(100dvh-68px)] flex-col gap-4 px-3 py-4 sm:px-5 lg:px-6">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-600">
            <Rotate3d className="size-3.5" aria-hidden="true" />
            Spatial inventory
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-slate-900">
            Rooms in 3D
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Navigate RoomPlan scans and open inventory items at their measured positions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
            {scans.length} room{scans.length === 1 ? "" : "s"}
          </span>
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
            {manifest?.placements.length ?? 0} positioned item
            {(manifest?.placements.length ?? 0) === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid min-h-[680px] flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[280px_minmax(0,1fr)_300px]">
        <aside className="border-b border-slate-200 bg-[#fbfbfc] p-3 lg:border-b-0 lg:border-r">
          <p className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400">
            Scanned rooms
          </p>
          <div className="space-y-1">
            {scans.map((scan) => {
              const active = scan.id === selectedScanId;
              return (
                <button
                  key={scan.id}
                  type="button"
                  onClick={() => selectScan(scan.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition",
                    active
                      ? "bg-violet-100 text-violet-900"
                      : "text-slate-700 hover:bg-slate-100",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-xl",
                      active ? "bg-violet-600 text-white" : "bg-white text-slate-500 shadow-sm",
                    )}
                  >
                    <Box className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{scan.roomName}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">
                      Revision {scan.revision} · {scan.placementCount} items
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 opacity-45" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </aside>

        <section className="relative min-h-[430px] overflow-hidden bg-[#f3f5f7]">
          {manifest && !loadingScene ? (
            <RoomSceneCanvas
              manifest={manifest}
              selectedResourceId={selectedResourceId}
              onSelectResource={selectResource}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-slate-400">
              <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
            </div>
          )}

          {selectedPlacement ? (
            <SelectedPlacementCard placement={selectedPlacement} />
          ) : null}

          {manifest && !manifest.placements.length ? (
            <div className="absolute inset-x-4 bottom-14 mx-auto max-w-md rounded-2xl border border-white/80 bg-white/90 p-4 text-center shadow-lg backdrop-blur">
              <MapPin className="mx-auto size-5 text-violet-500" aria-hidden="true" />
              <p className="mt-2 text-sm font-semibold text-slate-800">No items placed yet</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Capture an item in this room with the AR mode in the iPhone app.
              </p>
            </div>
          ) : null}
        </section>

        <aside className="flex min-h-0 flex-col border-t border-slate-200 bg-white lg:border-l lg:border-t-0">
          <div className="border-b border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-slate-900">
                  {manifest?.room.name ?? "Room"}
                </h2>
                {manifest ? (
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <CalendarClock className="size-3.5" aria-hidden="true" />
                    {formatDate(manifest.scan.capturedAt)}
                  </p>
                ) : null}
              </div>
              {modelAsset ? (
                <a
                  href={modelAsset.url}
                  className="grid size-9 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-violet-200 hover:text-violet-600"
                  title="Download original USDZ"
                  aria-label="Download original USDZ"
                >
                  <Download className="size-4" aria-hidden="true" />
                </a>
              ) : null}
            </div>
            <label className="relative mt-4 block">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search positioned items…"
                className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs outline-none transition focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
              />
            </label>
          </div>

          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
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
                        active ? "bg-orange-50" : "hover:bg-slate-50",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-xl",
                          active
                            ? "bg-orange-500 text-white"
                            : "bg-violet-100 text-violet-600",
                        )}
                      >
                        <PackageOpen className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-slate-800">
                          {placement.resource.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-slate-500">
                          {placement.position.map((value) => value.toFixed(2)).join(" · ")} m
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-slate-400">
                <Boxes className="mx-auto mb-2 size-5" aria-hidden="true" />
                No matching items
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function SelectedPlacementCard({ placement }: { placement: ClientRoomPlacement }) {
  return (
    <div className="absolute bottom-12 left-3 z-10 w-[min(330px,calc(100%-24px))] rounded-2xl border border-white/80 bg-white/92 p-3 shadow-xl backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-orange-100 text-orange-600">
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
          <p className="truncate text-sm font-semibold text-slate-900">
            {placement.resource.name}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            Accuracy {Math.round(placement.confidence * 100)}% · {placement.method}
          </p>
        </div>
        <Link
          href={`/inventory/${placement.resource.id}`}
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-600 text-white transition hover:bg-violet-700"
          aria-label={`Open ${placement.resource.name}`}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
