"use client";

import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiPolygon,
  Point,
  Polygon,
  Position,
} from "geojson";
import {
  type GeoJSONSource,
  LngLatBounds,
  type Map as MapLibreMap,
  type MapLayerMouseEvent,
  type MapMouseEvent,
  type MapOptions,
  Map as MapLibre,
  NavigationControl,
} from "maplibre-gl";
import { useT } from "next-i18next/client";
import { useEffect, useMemo, useRef } from "react";

import type { ClientRoomSceneManifest } from "@/lib/client-types";
import {
  roomWorldDeltaTransform,
  rotateRoomTransform,
  translateRoomTransform,
} from "@/lib/room-floor-layout";
import type { SpatialMatrix4, SpatialVector3 } from "@/lib/room-scene-contract";
import {
  geographicToLocalArkit,
  isSpatialGeoreference,
  localArkitToGeographic,
  roomSceneFootprintToGeoJson,
  sceneFloorPolygons,
  transformSpatialPoint,
  type SpatialGeoreference,
} from "@/lib/spatial-georeference";

type RoomLayoutMapCanvasProps = {
  manifests: ClientRoomSceneManifest[];
  fallbackGeoreference?: SpatialGeoreference | null;
  viewGeoreference?: SpatialGeoreference | null;
  selectedScanId: string | null;
  onSelectRoom: (scanId: string) => void;
  onChangeTransform: (scanId: string, transform: SpatialMatrix4) => void;
  backgroundOnly?: boolean;
  editing?: boolean;
  onViewportChange?: (viewport: RoomMapViewport) => void;
};

export type RoomMapViewport = {
  center: SpatialVector3;
  headingDegrees: number;
  metersPerPixel: number;
};

type RoomFeatureProperties = {
  kind: "room";
  scanId: string;
  roomName: string;
  selected: boolean;
};

type HandleFeatureProperties = {
  kind: "center-handle" | "rotation-line" | "rotation-handle";
  scanId: string;
};

type LayoutFeature = Feature<
  Polygon | MultiPolygon | Point | LineString,
  RoomFeatureProperties | HandleFeatureProperties
>;

type RoomMapGeometry = {
  anchor: SpatialGeoreference;
  center: SpatialVector3;
  rotationHandle: SpatialVector3;
};

type DragInteraction =
  | {
      kind: "move";
      scanId: string;
      anchor: SpatialGeoreference;
      start: SpatialVector3;
      transform: SpatialMatrix4;
    }
  | {
      kind: "rotate";
      scanId: string;
      anchor: SpatialGeoreference;
      center: SpatialVector3;
      startAngle: number;
      transform: SpatialMatrix4;
    };

const MAPBOX_ACCESS_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim();

function mapboxTileUrl(style: string) {
  return `https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/512/{z}/{x}/{y}?access_token=${encodeURIComponent(MAPBOX_ACCESS_TOKEN ?? "")}`;
}

const STREET_STYLE: MapOptions["style"] = MAPBOX_ACCESS_TOKEN
  ? {
      version: 8,
      sources: {
        "mapbox-streets": {
          type: "raster",
          tiles: [mapboxTileUrl("streets-v12")],
          tileSize: 512,
          attribution: "© Mapbox © OpenStreetMap",
        },
      },
      layers: [
        {
          id: "mapbox-streets",
          type: "raster",
          source: "mapbox-streets",
        },
      ],
    }
  : process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim()
    || "https://tiles.openfreemap.org/styles/liberty";

const sourceId = "room-layout-map";
const layerIds = {
  fill: "room-layout-fill",
  line: "room-layout-line",
  labels: "room-layout-labels",
  rotationLine: "room-layout-rotation-line",
  center: "room-layout-center",
  rotation: "room-layout-rotation",
};

function manifestAnchor(
  manifest: ClientRoomSceneManifest,
  fallbackGeoreference?: SpatialGeoreference | null,
) {
  const anchor = manifest.scan.georeference ?? manifest.georeference;
  if (isSpatialGeoreference(anchor)) return anchor;
  return isSpatialGeoreference(fallbackGeoreference)
    ? fallbackGeoreference
    : null;
}

function layoutTransform(manifest: ClientRoomSceneManifest) {
  return manifest.scan.layoutTransform ?? manifest.scan.scene.worldFromModel;
}

function averagePoint(points: readonly SpatialVector3[]): SpatialVector3 {
  const total = points.reduce<SpatialVector3>(
    (sum, point) => [
      sum[0] + point[0],
      sum[1] + point[1],
      sum[2] + point[2],
    ],
    [0, 0, 0],
  );
  return points.length
    ? [total[0] / points.length, total[1] / points.length, total[2] / points.length]
    : [0, 0, 0];
}

function roomMapGeometry(
  manifest: ClientRoomSceneManifest,
  fallbackGeoreference?: SpatialGeoreference | null,
): RoomMapGeometry | null {
  const anchor = manifestAnchor(manifest, fallbackGeoreference);
  if (!anchor) return null;
  const capturedPoints = sceneFloorPolygons(manifest.scan.scene).flat();
  if (!capturedPoints.length) return null;
  const capturedCenter = averagePoint(capturedPoints);
  const handleDistance = Math.max(
    1.25,
    ...capturedPoints.map((point) =>
      Math.hypot(point[0] - capturedCenter[0], point[2] - capturedCenter[2])),
  ) + 0.85;
  const worldDelta = roomWorldDeltaTransform(
    manifest.scan.scene.worldFromModel,
    layoutTransform(manifest),
  );
  return {
    anchor,
    center: transformSpatialPoint(worldDelta, capturedCenter),
    rotationHandle: transformSpatialPoint(worldDelta, [
      capturedCenter[0] + handleDistance,
      capturedCenter[1],
      capturedCenter[2],
    ]),
  };
}

function geographicPosition(point: SpatialVector3, anchor: SpatialGeoreference): Position {
  const coordinate = localArkitToGeographic(point, anchor);
  return [coordinate.longitude, coordinate.latitude];
}

function mapCollection(props: RoomLayoutMapCanvasProps): FeatureCollection {
  const features: LayoutFeature[] = [];
  for (const manifest of props.manifests) {
    const geometry = roomMapGeometry(manifest, props.fallbackGeoreference);
    if (!geometry) continue;
    const selected = manifest.scan.id === props.selectedScanId;
    const worldDelta = roomWorldDeltaTransform(
      manifest.scan.scene.worldFromModel,
      layoutTransform(manifest),
    );
    const footprint = roomSceneFootprintToGeoJson(
      manifest.scan.scene,
      geometry.anchor,
      {
        kind: "room" as const,
        scanId: manifest.scan.id,
        roomName: manifest.room.name,
        selected,
      },
      worldDelta,
    );
    footprint.id = `room:${manifest.scan.id}`;
    features.push(footprint);

    if (!selected || props.editing === false) continue;
    const center = geographicPosition(geometry.center, geometry.anchor);
    const rotationHandle = geographicPosition(
      geometry.rotationHandle,
      geometry.anchor,
    );
    features.push(
      {
        type: "Feature",
        id: `rotation-line:${manifest.scan.id}`,
        properties: { kind: "rotation-line", scanId: manifest.scan.id },
        geometry: { type: "LineString", coordinates: [center, rotationHandle] },
      },
      {
        type: "Feature",
        id: `center:${manifest.scan.id}`,
        properties: { kind: "center-handle", scanId: manifest.scan.id },
        geometry: { type: "Point", coordinates: center },
      },
      {
        type: "Feature",
        id: `rotation:${manifest.scan.id}`,
        properties: { kind: "rotation-handle", scanId: manifest.scan.id },
        geometry: { type: "Point", coordinates: rotationHandle },
      },
    );
  }
  return { type: "FeatureCollection", features };
}

function installLayers(map: MapLibreMap, data: FeatureCollection) {
  map.addSource(sourceId, { type: "geojson", data });
  map.addLayer({
    id: layerIds.fill,
    type: "fill",
    source: sourceId,
    filter: ["==", ["get", "kind"], "room"],
    paint: {
      "fill-color": ["case", ["get", "selected"], "#635bff", "#64748b"],
      "fill-opacity": ["case", ["get", "selected"], 0.38, 0.18],
    },
  });
  map.addLayer({
    id: layerIds.line,
    type: "line",
    source: sourceId,
    filter: ["==", ["get", "kind"], "room"],
    paint: {
      "line-color": ["case", ["get", "selected"], "#4f46e5", "#475569"],
      "line-width": ["case", ["get", "selected"], 4, 2],
    },
  });
  map.addLayer({
    id: layerIds.labels,
    type: "symbol",
    source: sourceId,
    filter: ["==", ["get", "kind"], "room"],
    layout: {
      "text-field": ["get", "roomName"],
      "text-size": 12,
      "text-anchor": "center",
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#312e81",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.5,
    },
  });
  map.addLayer({
    id: layerIds.rotationLine,
    type: "line",
    source: sourceId,
    filter: ["==", ["get", "kind"], "rotation-line"],
    paint: {
      "line-color": "#f97316",
      "line-width": 2.5,
      "line-dasharray": [1.5, 1],
    },
  });
  map.addLayer({
    id: layerIds.center,
    type: "circle",
    source: sourceId,
    filter: ["==", ["get", "kind"], "center-handle"],
    paint: {
      "circle-color": "#635bff",
      "circle-radius": 6,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: layerIds.rotation,
    type: "circle",
    source: sourceId,
    filter: ["==", ["get", "kind"], "rotation-handle"],
    paint: {
      "circle-color": "#f97316",
      "circle-radius": 9,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 3,
    },
  });
}

function collectionCoordinates(collection: FeatureCollection) {
  return collection.features.flatMap((feature) => {
    if (feature.geometry.type === "Polygon") {
      return feature.geometry.coordinates[0] ?? [];
    }
    if (feature.geometry.type === "MultiPolygon") {
      return feature.geometry.coordinates.flatMap((polygon) => polygon[0] ?? []);
    }
    return [];
  });
}

export function RoomLayoutMapCanvas(props: RoomLayoutMapCanvasProps) {
  const { t, i18n } = useT("spatial");
  const language = i18n.resolvedLanguage ?? i18n.language;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const latestRef = useRef(props);
  const interactionRef = useRef<DragInteraction | null>(null);
  const fittedRoomsRef = useRef<string | null>(null);
  const initialCollection = useMemo(() => mapCollection(props), [props]);

  useEffect(() => {
    latestRef.current = props;
    const map = mapRef.current;
    const source = map?.getSource(sourceId) as GeoJSONSource | undefined;
    source?.setData(mapCollection(props));
  }, [props]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MapLibre({
      container: containerRef.current,
      style: STREET_STYLE,
      center: [13.7373, 51.0504],
      zoom: 18,
      maxZoom: 22,
      interactive: !props.backgroundOnly,
      attributionControl: { compact: true },
      locale: {
        "AttributionControl.ToggleAttribution": t("map.controls.toggleAttribution"),
        "Map.Title": t("map.controls.mapTitle"),
        "NavigationControl.ResetBearing": t("map.controls.resetBearing"),
        "NavigationControl.ZoomIn": t("map.controls.zoomIn"),
        "NavigationControl.ZoomOut": t("map.controls.zoomOut"),
      },
    });
    mapRef.current = map;
    if (!props.backgroundOnly) {
      map.addControl(new NavigationControl({ visualizePitch: false }), "bottom-right");
    }

    const emitViewport = () => {
      const anchor = latestRef.current.viewGeoreference;
      if (!isSpatialGeoreference(anchor)) return;
      const center = map.getCenter();
      const localReference = anchor.localReferencePosition ?? [0, 0, 0];
      const heading = anchor.headingDegrees * Math.PI / 180;
      const oneMeterEast = localArkitToGeographic([
        localReference[0] + Math.cos(heading),
        localReference[1],
        localReference[2] - Math.sin(heading),
      ], anchor);
      const anchorPixel = map.project([anchor.longitude, anchor.latitude]);
      const eastPixel = map.project([
        oneMeterEast.longitude,
        oneMeterEast.latitude,
      ]);
      const pixelsPerMeter = Math.hypot(
        eastPixel.x - anchorPixel.x,
        eastPixel.y - anchorPixel.y,
      );
      if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 0) return;
      latestRef.current.onViewportChange?.({
        center: geographicToLocalArkit(
          { longitude: center.lng, latitude: center.lat },
          anchor,
        ),
        headingDegrees: anchor.headingDegrees,
        metersPerPixel: 1 / pixelsPerMeter,
      });
    };

    const fitRooms = (data: FeatureCollection) => {
      const coordinates = collectionCoordinates(data);
      const first = coordinates[0];
      if (!first) return;
      const bounds = coordinates.reduce(
        (result, coordinate) => result.extend([coordinate[0]!, coordinate[1]!]),
        new LngLatBounds([first[0]!, first[1]!], [first[0]!, first[1]!]),
      );
      map.fitBounds(bounds, { padding: 90, maxZoom: 20.5, duration: 0 });
    };

    map.on("load", () => {
      const data = mapCollection(latestRef.current);
      if (!latestRef.current.backgroundOnly) installLayers(map, data);
      fitRooms(data);
      emitViewport();
      fittedRoomsRef.current = latestRef.current.manifests
        .map((manifest) => manifest.scan.id)
        .sort()
        .join("|");
    });

    map.on("moveend", emitViewport);
    map.on("resize", emitViewport);

    const manifestForScan = (scanId: string) =>
      latestRef.current.manifests.find((manifest) => manifest.scan.id === scanId);
    const scanIdFromEvent = (event: MapLayerMouseEvent) => {
      const scanId = event.features?.[0]?.properties?.scanId;
      return typeof scanId === "string" ? scanId : null;
    };
    const disableMapGesture = (event: MapLayerMouseEvent) => {
      event.preventDefault();
      map.dragPan.disable();
      map.getCanvas().style.cursor = "grabbing";
    };

    if (!props.backgroundOnly) {
      map.on("mousedown", layerIds.fill, (event: MapLayerMouseEvent) => {
        const scanId = scanIdFromEvent(event);
        const manifest = scanId ? manifestForScan(scanId) : null;
        const anchor = manifest
          ? manifestAnchor(manifest, latestRef.current.fallbackGeoreference)
          : null;
        if (!scanId || !manifest || !anchor) return;
        latestRef.current.onSelectRoom(scanId);
        if (latestRef.current.editing === false) return;
        disableMapGesture(event);
        interactionRef.current = {
          kind: "move",
          scanId,
          anchor,
          start: geographicToLocalArkit(
            { longitude: event.lngLat.lng, latitude: event.lngLat.lat },
            anchor,
          ),
          transform: [...layoutTransform(manifest)] as SpatialMatrix4,
        };
      });

      map.on("mousedown", layerIds.rotation, (event: MapLayerMouseEvent) => {
        const scanId = scanIdFromEvent(event);
        const manifest = scanId ? manifestForScan(scanId) : null;
        const geometry = manifest
          ? roomMapGeometry(manifest, latestRef.current.fallbackGeoreference)
          : null;
        if (!scanId || !manifest || !geometry || latestRef.current.editing === false) return;
        disableMapGesture(event);
        const pointer = geographicToLocalArkit(
          { longitude: event.lngLat.lng, latitude: event.lngLat.lat },
          geometry.anchor,
        );
        interactionRef.current = {
          kind: "rotate",
          scanId,
          anchor: geometry.anchor,
          center: geometry.center,
          startAngle: Math.atan2(
            -(pointer[2] - geometry.center[2]),
            pointer[0] - geometry.center[0],
          ),
          transform: [...layoutTransform(manifest)] as SpatialMatrix4,
        };
      });
    }

    const onMove = (event: MapMouseEvent) => {
      const interaction = interactionRef.current;
      if (!interaction || latestRef.current.editing === false) return;
      const pointer = geographicToLocalArkit(
        { longitude: event.lngLat.lng, latitude: event.lngLat.lat },
        interaction.anchor,
      );
      if (interaction.kind === "move") {
        latestRef.current.onChangeTransform(
          interaction.scanId,
          translateRoomTransform(interaction.transform, [
            pointer[0] - interaction.start[0],
            0,
            pointer[2] - interaction.start[2],
          ]),
        );
        return;
      }
      const angle = Math.atan2(
        -(pointer[2] - interaction.center[2]),
        pointer[0] - interaction.center[0],
      );
      latestRef.current.onChangeTransform(
        interaction.scanId,
        rotateRoomTransform(
          interaction.transform,
          angle - interaction.startAngle,
        ),
      );
    };
    const endInteraction = () => {
      if (!interactionRef.current) return;
      interactionRef.current = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = "";
    };
    map.on("mousemove", onMove);
    map.on("mouseup", endInteraction);
    window.addEventListener("mouseup", endInteraction);

    if (!props.backgroundOnly) {
      for (const layer of [layerIds.fill, layerIds.rotation]) {
        map.on("mouseenter", layer, () => {
          if (!interactionRef.current) {
            map.getCanvas().style.cursor = layer === layerIds.rotation ? "grab" : "move";
          }
        });
        map.on("mouseleave", layer, () => {
          if (!interactionRef.current) map.getCanvas().style.cursor = "";
        });
      }
    }

    return () => {
      window.removeEventListener("mouseup", endInteraction);
      map.remove();
      mapRef.current = null;
    };
  }, [language, props.backgroundOnly, t]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource(sourceId) as GeoJSONSource | undefined;
    if (!map || !source) return;
    const signature = props.manifests
      .map((manifest) => manifest.scan.id)
      .sort()
      .join("|");
    if (signature === fittedRoomsRef.current) return;
    const coordinates = collectionCoordinates(initialCollection);
    const first = coordinates[0];
    if (!first) return;
    const bounds = coordinates.reduce(
      (result, coordinate) => result.extend([coordinate[0]!, coordinate[1]!]),
      new LngLatBounds([first[0]!, first[1]!], [first[0]!, first[1]!]),
    );
    map.fitBounds(bounds, { padding: 90, maxZoom: 20.5, duration: 500 });
    fittedRoomsRef.current = signature;
  }, [initialCollection, props.manifests]);

  return (
    <div
      ref={containerRef}
      className="size-full min-h-[430px]"
      aria-label={t("rooms.layout.mapCanvas")}
    />
  );
}
