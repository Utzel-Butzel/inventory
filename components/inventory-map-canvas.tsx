"use client";

import {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type MapLayerMouseEvent,
  type MapMouseEvent,
  type MapOptions,
  LngLatBounds,
  Map as MapLibre,
  Marker,
  NavigationControl,
} from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry, Point, Polygon } from "geojson";
import { useT } from "next-i18next/client";
import { useEffect, useRef } from "react";

import type {
  ResourceMapCoordinate,
  ResourceMapFeature,
} from "@/db/schema";
import type { ClientResource } from "@/lib/client-types";
import {
  displayedMapCoordinates,
  isRenderableMapFeature,
} from "@/lib/map-features";
import type { SpatialMapFeatureProperties } from "@/lib/spatial-map-features";

export type MapDrawMode = "idle" | "point" | "polygon";
export type MapBasemap = "streets" | "satellite";

type MapFeatureProperties = {
  resourceId: string;
  featureId: string;
  name: string;
  selected: boolean;
  active: boolean;
};

type VertexProperties = {
  featureId: string;
  vertexIndex: number;
  kind: "vertex" | "midpoint";
};

type InventoryMapCanvasProps = {
  resources: ClientResource[];
  featuresByResource: Record<string, ResourceMapFeature[]>;
  selectedIds: string[];
  activeResourceId: string | null;
  activeFeatureId: string | null;
  editable: boolean;
  drawMode: MapDrawMode;
  basemap: MapBasemap;
  polygonDraft: ResourceMapCoordinate[];
  spatialFeatures?: FeatureCollection<Geometry, SpatialMapFeatureProperties>;
  activeSpatialStructureId?: string | null;
  onSelectSpatialFeature?: (feature: SpatialMapFeatureProperties) => void;
  onSelectResource: (resourceId: string, additive: boolean) => void;
  onSelectFeature: (featureId: string) => void;
  onPlacePoint: (coordinate: ResourceMapCoordinate) => void;
  onAddPolygonPoint: (coordinate: ResourceMapCoordinate) => void;
  onChangeFeatures: (resourceId: string, features: ResourceMapFeature[]) => void;
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
const SATELLITE_TILE_URL =
  MAPBOX_ACCESS_TOKEN
    ? mapboxTileUrl("satellite-streets-v12")
    : process.env.NEXT_PUBLIC_SATELLITE_TILE_URL?.trim()
      || "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const sourceIds = {
  resources: "inventory-resources",
  spatial: "inventory-spatial-structures",
  vertices: "inventory-edit-vertices",
  draft: "inventory-polygon-draft",
  satellite: "inventory-satellite",
};

function closeRing(coordinates: ResourceMapCoordinate[]) {
  if (!coordinates.length) return coordinates;
  const first = coordinates[0]!;
  return [...coordinates, [first[0], first[1]] as ResourceMapCoordinate];
}

function collections(
  resources: ClientResource[],
  featuresByResource: Record<string, ResourceMapFeature[]>,
  selectedIds: string[],
  activeResourceId: string | null,
) {
  const selected = new Set(selectedIds);
  const points: Array<Feature<Point, MapFeatureProperties>> = [];
  const polygons: Array<Feature<Polygon, MapFeatureProperties>> = [];

  for (const resource of resources) {
    for (const feature of featuresByResource[resource.id] ?? []) {
      if (!isRenderableMapFeature(feature)) continue;
      const properties: MapFeatureProperties = {
        resourceId: resource.id,
        featureId: feature.id,
        name: resource.name,
        selected: selected.has(resource.id),
        active: resource.id === activeResourceId,
      };
      if (feature.type === "point") {
        points.push({
          type: "Feature",
          id: `${resource.id}:${feature.id}`,
          properties,
          geometry: { type: "Point", coordinates: feature.coordinates },
        });
      } else {
        polygons.push({
          type: "Feature",
          id: `${resource.id}:${feature.id}`,
          properties,
          geometry: { type: "Polygon", coordinates: [feature.coordinates] },
        });
      }
    }
  }

  return {
    points: { type: "FeatureCollection", features: points } satisfies FeatureCollection,
    polygons: { type: "FeatureCollection", features: polygons } satisfies FeatureCollection,
  };
}

function defaultViewportCoordinates(props: InventoryMapCanvasProps) {
  const inventoryCoordinates = displayedMapCoordinates(
    props.resources,
    props.featuresByResource,
  );
  return inventoryCoordinates.length
    ? inventoryCoordinates
    : spatialCoordinates(props.spatialFeatures);
}

function fitCoordinates(
  map: MapLibreMap,
  coordinates: ResourceMapCoordinate[],
  duration: number,
) {
  const first = coordinates[0];
  if (!first) return;
  const bounds = coordinates.reduce(
    (result, coordinate) => result.extend(coordinate),
    new LngLatBounds(first, first),
  );
  map.fitBounds(bounds, { padding: 70, maxZoom: 19, duration });
}

function coordinateSignature(coordinates: ResourceMapCoordinate[]) {
  return coordinates.map((coordinate) => `${coordinate[0]},${coordinate[1]}`).join("|");
}

function editHandles(feature: ResourceMapFeature | undefined) {
  const vertices: Array<Feature<Point, VertexProperties>> = [];
  const midpoints: Array<Feature<Point, VertexProperties>> = [];
  if (!feature) return { vertices, midpoints };

  if (feature.type === "point") {
    vertices.push({
      type: "Feature",
      properties: { featureId: feature.id, vertexIndex: 0, kind: "vertex" },
      geometry: { type: "Point", coordinates: feature.coordinates },
    });
    return { vertices, midpoints };
  }

  const ring = feature.coordinates.slice(0, -1);
  ring.forEach((coordinate, index) => {
    vertices.push({
      type: "Feature",
      properties: { featureId: feature.id, vertexIndex: index, kind: "vertex" },
      geometry: { type: "Point", coordinates: coordinate },
    });
    const next = ring[(index + 1) % ring.length];
    if (next) {
      midpoints.push({
        type: "Feature",
        properties: {
          featureId: feature.id,
          vertexIndex: index + 1,
          kind: "midpoint",
        },
        geometry: {
          type: "Point",
          coordinates: [
            (coordinate[0] + next[0]) / 2,
            (coordinate[1] + next[1]) / 2,
          ],
        },
      });
    }
  });
  return { vertices, midpoints };
}

function draftCollection(coordinates: ResourceMapCoordinate[]) {
  if (!coordinates.length) {
    return { type: "FeatureCollection", features: [] } satisfies FeatureCollection;
  }
  const feature: Feature = coordinates.length > 2
    ? {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [closeRing(coordinates)] },
      }
    : {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates },
      };
  return { type: "FeatureCollection", features: [feature] } satisfies FeatureCollection;
}

function setSourceData(map: MapLibreMap, id: string, data: FeatureCollection) {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  source?.setData(data);
}

function spatialCoordinates(
  collection: FeatureCollection<Geometry, SpatialMapFeatureProperties> | undefined,
): ResourceMapCoordinate[] {
  if (!collection) return [];
  return collection.features.flatMap((feature) => {
    if (feature.geometry.type === "Point") {
      return [[feature.geometry.coordinates[0], feature.geometry.coordinates[1]] as ResourceMapCoordinate];
    }
    if (feature.geometry.type === "Polygon") {
      return (feature.geometry.coordinates[0] ?? []).map(
        (coordinate) => [coordinate[0], coordinate[1]] as ResourceMapCoordinate,
      );
    }
    if (feature.geometry.type === "MultiPolygon") {
      return feature.geometry.coordinates.flatMap((polygon) =>
        (polygon[0] ?? []).map(
          (coordinate) => [coordinate[0], coordinate[1]] as ResourceMapCoordinate,
        ),
      );
    }
    return [];
  });
}

function activeStructureCoordinate(
  collection: FeatureCollection<Geometry, SpatialMapFeatureProperties> | undefined,
  structureId: string | null | undefined,
): ResourceMapCoordinate | null {
  if (!collection || !structureId) return null;
  const marker = collection.features.find(
    (feature) =>
      feature.properties.structureId === structureId &&
      feature.properties.spatialKind === "structure-marker" &&
      feature.geometry.type === "Point",
  );
  return marker?.geometry.type === "Point"
    ? [marker.geometry.coordinates[0], marker.geometry.coordinates[1]]
    : null;
}

function installLayers(map: MapLibreMap) {
  if (map.getSource(sourceIds.resources)) return;

  map.addSource(sourceIds.satellite, {
    type: "raster",
    tiles: [SATELLITE_TILE_URL],
    tileSize: MAPBOX_ACCESS_TOKEN ? 512 : 256,
    attribution: MAPBOX_ACCESS_TOKEN ? "© Mapbox © OpenStreetMap" : "Tiles © Esri",
  });
  map.addLayer({
    id: sourceIds.satellite,
    type: "raster",
    source: sourceIds.satellite,
    layout: { visibility: "none" },
  });

  map.addSource(sourceIds.spatial, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "inventory-spatial-structure-fill",
    type: "fill",
    source: sourceIds.spatial,
    filter: ["==", ["get", "spatialKind"], "structure-footprint"],
    maxzoom: 21,
    paint: {
      "fill-color": ["case", ["get", "selected"], "#635bff", "#0f766e"],
      "fill-opacity": [
        "interpolate", ["linear"], ["zoom"],
        12, 0.14,
        18, 0.25,
      ],
    },
  });
  map.addLayer({
    id: "inventory-spatial-structure-line",
    type: "line",
    source: sourceIds.spatial,
    filter: ["==", ["get", "spatialKind"], "structure-footprint"],
    paint: {
      "line-color": ["case", ["get", "selected"], "#4f46e5", "#0f766e"],
      "line-width": ["case", ["get", "selected"], 3, 2],
    },
  });
  map.addLayer({
    id: "inventory-spatial-room-fill",
    type: "fill",
    source: sourceIds.spatial,
    filter: ["==", ["get", "spatialKind"], "room-footprint"],
    minzoom: 17,
    paint: {
      "fill-color": "#8b5cf6",
      "fill-opacity": 0.24,
    },
  });
  map.addLayer({
    id: "inventory-spatial-room-line",
    type: "line",
    source: sourceIds.spatial,
    filter: ["==", ["get", "spatialKind"], "room-footprint"],
    minzoom: 17,
    paint: {
      "line-color": "#6d28d9",
      "line-width": 2.5,
    },
  });
  map.addLayer({
    id: "inventory-spatial-structure-points",
    type: "circle",
    source: sourceIds.spatial,
    filter: ["==", ["get", "spatialKind"], "structure-marker"],
    maxzoom: 18.5,
    paint: {
      "circle-color": ["case", ["get", "selected"], "#635bff", "#0f766e"],
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        8, 7,
        17, 12,
      ],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 3,
    },
  });
  map.addLayer({
    id: "inventory-spatial-item-points",
    type: "circle",
    source: sourceIds.spatial,
    filter: ["==", ["get", "spatialKind"], "positioned-item"],
    minzoom: 18,
    paint: {
      "circle-color": "#f97316",
      "circle-radius": 6,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "inventory-spatial-labels",
    type: "symbol",
    source: sourceIds.spatial,
    filter: ["in", ["get", "spatialKind"], ["literal", ["structure-marker", "room-footprint"]]],
    layout: {
      "text-field": [
        "case",
        ["==", ["get", "spatialKind"], "room-footprint"],
        ["get", "roomName"],
        ["get", "structureName"],
      ],
      "text-size": 12,
      "text-offset": [0, 1.45],
      "text-anchor": "top",
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#312e81",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.5,
    },
  });

  map.addSource(sourceIds.resources, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "inventory-polygons-fill",
    type: "fill",
    source: sourceIds.resources,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "fill-color": ["case", ["get", "selected"], "#635bff", "#64748b"],
      "fill-opacity": ["case", ["get", "selected"], 0.28, 0.14],
    },
  });
  map.addLayer({
    id: "inventory-polygons-line",
    type: "line",
    source: sourceIds.resources,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "line-color": ["case", ["get", "selected"], "#4f46e5", "#475569"],
      "line-width": ["case", ["get", "active"], 4, ["get", "selected"], 3, 2],
    },
  });
  map.addLayer({
    id: "inventory-labels",
    type: "symbol",
    source: sourceIds.resources,
    layout: {
      "text-field": ["get", "name"],
      "text-size": 12,
      "text-offset": [0, 1.35],
      "text-anchor": "top",
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#1f2937",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.5,
    },
  });

  map.addSource(sourceIds.draft, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "inventory-draft-fill",
    type: "fill",
    source: sourceIds.draft,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": "#f97316", "fill-opacity": 0.16 },
  });
  map.addLayer({
    id: "inventory-draft-line",
    type: "line",
    source: sourceIds.draft,
    paint: {
      "line-color": "#f97316",
      "line-width": 3,
      "line-dasharray": [1.5, 1],
    },
  });

  map.addSource(sourceIds.vertices, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "inventory-midpoints",
    type: "circle",
    source: sourceIds.vertices,
    filter: ["==", ["get", "kind"], "midpoint"],
    paint: {
      "circle-color": "#10b981",
      "circle-radius": 5,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "inventory-vertices",
    type: "circle",
    source: sourceIds.vertices,
    filter: ["==", ["get", "kind"], "vertex"],
    paint: {
      "circle-color": "#f97316",
      "circle-radius": 7,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
}

export function InventoryMapCanvas(props: InventoryMapCanvasProps) {
  const { t, i18n } = useT("spatial");
  const language = i18n.resolvedLanguage ?? i18n.language;
  const {
    resources,
    featuresByResource,
    selectedIds,
    activeResourceId,
    activeFeatureId,
    editable,
    drawMode,
    basemap,
    polygonDraft,
    spatialFeatures,
    activeSpatialStructureId,
  } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const lastDefaultViewportRef = useRef<string | null>(null);
  const latestRef = useRef(props);

  useEffect(() => {
    latestRef.current = props;
  }, [props]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const initialCoordinates = defaultViewportCoordinates(props);
    const firstCoordinate = initialCoordinates[0];

    const map = new MapLibre({
      container: containerRef.current,
      style: STREET_STYLE,
      center: firstCoordinate ?? [13.7373, 51.0504],
      zoom: firstCoordinate ? 18 : 13,
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
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");

    const updateData = () => {
      installLayers(map);
      const current = latestRef.current;
      const data = collections(
        current.resources,
        current.featuresByResource,
        current.selectedIds,
        current.activeResourceId,
      );
      setSourceData(map, sourceIds.resources, {
        type: "FeatureCollection",
        features: [...data.polygons.features, ...data.points.features],
      });
      setSourceData(
        map,
        sourceIds.spatial,
        current.spatialFeatures ?? { type: "FeatureCollection", features: [] },
      );
      const selectedStructureCoordinate = activeStructureCoordinate(
        current.spatialFeatures,
        current.activeSpatialStructureId,
      );
      if (selectedStructureCoordinate) {
        map.jumpTo({
          center: selectedStructureCoordinate,
          zoom: Math.max(map.getZoom(), 18),
        });
        lastDefaultViewportRef.current = null;
      }
      const activeFeature = current.activeResourceId
        ? (current.featuresByResource[current.activeResourceId] ?? []).find(
            (feature) => feature.id === current.activeFeatureId,
          )
        : undefined;
      const handles = editHandles(current.editable ? activeFeature : undefined);
      setSourceData(map, sourceIds.vertices, {
        type: "FeatureCollection",
        features: [...handles.midpoints, ...handles.vertices],
      });
      setSourceData(
        map,
        sourceIds.draft,
        draftCollection(current.editable ? current.polygonDraft : []),
      );

      if (!current.activeSpatialStructureId) {
        const coordinates = defaultViewportCoordinates(current);
        fitCoordinates(map, coordinates, 0);
        lastDefaultViewportRef.current = coordinateSignature(coordinates);
      }
    };

    map.on("load", () => {
      updateData();
      map.setLayoutProperty(
        sourceIds.satellite,
        "visibility",
        latestRef.current.basemap === "satellite" ? "visible" : "none",
      );
    });

    map.on("click", (event: MapMouseEvent) => {
      const current = latestRef.current;
      if (current.editable && current.drawMode === "point") {
        current.onPlacePoint([event.lngLat.lng, event.lngLat.lat]);
        return;
      }
      if (current.editable && current.drawMode === "polygon") {
        current.onAddPolygonPoint([event.lngLat.lng, event.lngLat.lat]);
        return;
      }

      const midpoint = current.editable
        ? map.queryRenderedFeatures(event.point, {
            layers: ["inventory-midpoints"],
          })[0]
        : undefined;
      if (midpoint && current.activeResourceId && current.activeFeatureId) {
        const insertIndex = Number(midpoint.properties?.vertexIndex);
        const features = current.featuresByResource[current.activeResourceId] ?? [];
        const active = features.find((feature) => feature.id === current.activeFeatureId);
        if (active?.type === "polygon") {
          const ring = active.coordinates.slice(0, -1);
          const coordinate: ResourceMapCoordinate = [event.lngLat.lng, event.lngLat.lat];
          ring.splice(insertIndex, 0, coordinate);
          current.onChangeFeatures(
            current.activeResourceId,
            features.map((feature) =>
              feature.id === active.id ? { ...active, coordinates: closeRing(ring) } : feature,
            ),
          );
        }
        return;
      }

      const vertex = current.editable
        ? map.queryRenderedFeatures(event.point, {
            layers: ["inventory-vertices"],
          })[0]
        : undefined;
      if (
        vertex &&
        event.originalEvent.altKey &&
        current.activeResourceId &&
        current.activeFeatureId
      ) {
        const removeIndex = Number(vertex.properties?.vertexIndex);
        const features = current.featuresByResource[current.activeResourceId] ?? [];
        const active = features.find((feature) => feature.id === current.activeFeatureId);
        if (active?.type === "polygon" && active.coordinates.length > 4) {
          const ring = active.coordinates.slice(0, -1);
          ring.splice(removeIndex, 1);
          current.onChangeFeatures(
            current.activeResourceId,
            features.map((feature) =>
              feature.id === active.id ? { ...active, coordinates: closeRing(ring) } : feature,
            ),
          );
        }
        return;
      }

      const hit = map.queryRenderedFeatures(event.point, {
        layers: [
          "inventory-spatial-item-points",
          "inventory-spatial-room-fill",
          "inventory-spatial-room-line",
          "inventory-spatial-structure-points",
          "inventory-spatial-structure-fill",
          "inventory-spatial-structure-line",
          "inventory-polygons-fill",
          "inventory-polygons-line",
        ],
      })[0];
      const spatialKind = hit?.properties?.spatialKind as
        | SpatialMapFeatureProperties["spatialKind"]
        | undefined;
      if (spatialKind && current.onSelectSpatialFeature) {
        const feature = hit.properties as unknown as SpatialMapFeatureProperties;
        current.onSelectSpatialFeature(feature);
        if (spatialKind === "structure-marker" || spatialKind === "structure-footprint") {
          map.easeTo({ center: event.lngLat, zoom: Math.max(map.getZoom(), 18), duration: 700 });
        }
        return;
      }
      const resourceId = hit?.properties?.resourceId as string | undefined;
      const featureId = hit?.properties?.featureId as string | undefined;
      if (resourceId) {
        current.onSelectResource(
          resourceId,
          event.originalEvent.shiftKey || event.originalEvent.metaKey || event.originalEvent.ctrlKey,
        );
        if (featureId) current.onSelectFeature(featureId);
      }
    });

    let dragging: { featureId: string; vertexIndex: number } | null = null;
    const onMove = (event: MapMouseEvent) => {
      if (!dragging) return;
      const current = latestRef.current;
      if (!current.editable || !current.activeResourceId) return;
      const features = current.featuresByResource[current.activeResourceId] ?? [];
      const coordinate: ResourceMapCoordinate = [event.lngLat.lng, event.lngLat.lat];
      current.onChangeFeatures(
        current.activeResourceId,
        features.map((feature) => {
          if (feature.id !== dragging?.featureId) return feature;
          if (feature.type === "point") return { ...feature, coordinates: coordinate };
          const ring = feature.coordinates.slice(0, -1);
          ring[dragging.vertexIndex] = coordinate;
          return { ...feature, coordinates: closeRing(ring) };
        }),
      );
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = null;
      map.dragPan.enable();
    };
    map.on("mousedown", "inventory-vertices", (event: MapLayerMouseEvent) => {
      if (!latestRef.current.editable) return;
      const vertex = event.features?.[0];
      if (!vertex) return;
      event.preventDefault();
      dragging = {
        featureId: String(vertex.properties?.featureId),
        vertexIndex: Number(vertex.properties?.vertexIndex),
      };
      map.dragPan.disable();
    });
    map.on("mousemove", onMove);
    map.on("mouseup", onUp);
    map.on("mouseenter", "inventory-spatial-structure-points", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseenter", "inventory-spatial-room-fill", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseenter", "inventory-spatial-item-points", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseenter", "inventory-polygons-fill", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseenter", "inventory-vertices", () => { map.getCanvas().style.cursor = "grab"; });
    map.on("mouseleave", "inventory-spatial-structure-points", () => { map.getCanvas().style.cursor = ""; });
    map.on("mouseleave", "inventory-spatial-room-fill", () => { map.getCanvas().style.cursor = ""; });
    map.on("mouseleave", "inventory-spatial-item-points", () => { map.getCanvas().style.cursor = ""; });
    map.on("mouseleave", "inventory-polygons-fill", () => { map.getCanvas().style.cursor = ""; });
    map.on("mouseleave", "inventory-vertices", () => { map.getCanvas().style.cursor = ""; });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // MapLibre owns the map lifecycle; live prop values are read through latestRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, t]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const selected = new Set(selectedIds);
    const markers: Marker[] = [];
    for (const resource of resources) {
      for (const feature of featuresByResource[resource.id] ?? []) {
        if (feature.type !== "point" || !isRenderableMapFeature(feature)) continue;

        const isActive = resource.id === activeResourceId;
        const isSelected = selected.has(resource.id);
        const element = document.createElement("button");
        element.type = "button";
        element.dataset.inventoryMapPoint = feature.id;
        element.className = [
          "grid size-7 place-items-center rounded-full border-2 border-white text-white shadow-lg",
          "cursor-pointer transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-solid/30",
          isActive || isSelected ? "bg-brand-solid" : "bg-slate-600",
          isActive ? "scale-125" : "",
        ].join(" ");
        element.setAttribute("aria-label", `${resource.name} · ${feature.layer}`);
        element.title = `${resource.name} · ${feature.layer}`;

        const dot = document.createElement("span");
        dot.className = "size-2 rounded-full bg-white";
        element.append(dot);

        const activeEditHandle = editable
          && isActive
          && feature.id === activeFeatureId;
        if (activeEditHandle) {
          element.style.opacity = "0";
          element.style.pointerEvents = "none";
        }
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          const current = latestRef.current;
          current.onSelectResource(
            resource.id,
            event.shiftKey || event.metaKey || event.ctrlKey,
          );
          current.onSelectFeature(feature.id);
        });

        markers.push(
          new Marker({ element, anchor: "center" })
            .setLngLat(feature.coordinates)
            .addTo(map),
        );
      }
    }

    return () => {
      for (const marker of markers) marker.remove();
    };
  }, [activeFeatureId, activeResourceId, editable, featuresByResource, resources, selectedIds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource(sourceIds.resources)) return;
    const data = collections(resources, featuresByResource, selectedIds, activeResourceId);
    setSourceData(map, sourceIds.resources, {
      type: "FeatureCollection",
      features: [...data.polygons.features, ...data.points.features],
    });

    const activeFeature = activeResourceId
      ? (featuresByResource[activeResourceId] ?? []).find(
          (feature) => feature.id === activeFeatureId,
        )
      : undefined;
    const handles = editHandles(editable ? activeFeature : undefined);
    setSourceData(map, sourceIds.vertices, {
      type: "FeatureCollection",
      features: [...handles.midpoints, ...handles.vertices],
    });
    setSourceData(map, sourceIds.draft, draftCollection(editable ? polygonDraft : []));

    if (!activeSpatialStructureId) {
      const coordinates = defaultViewportCoordinates(latestRef.current);
      const signature = coordinateSignature(coordinates);
      if (signature !== lastDefaultViewportRef.current) {
        fitCoordinates(map, coordinates, 0);
        lastDefaultViewportRef.current = signature;
      }
    }
  }, [
    activeFeatureId,
    activeResourceId,
    editable,
    featuresByResource,
    polygonDraft,
    resources,
    selectedIds,
    spatialFeatures,
    activeSpatialStructureId,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource(sourceIds.spatial)) return;
    setSourceData(
      map,
      sourceIds.spatial,
      spatialFeatures ?? { type: "FeatureCollection", features: [] },
    );
    const matching = spatialFeatures?.features.filter(
      (feature) => feature.properties.structureId === activeSpatialStructureId,
    ) ?? [];
    if (activeSpatialStructureId && matching.length) {
      const point = matching.find(
        (feature) =>
          feature.properties.spatialKind === "structure-marker" &&
          feature.geometry.type === "Point",
      );
      if (point?.geometry.type === "Point") {
        lastDefaultViewportRef.current = null;
        map.easeTo({
          center: [point.geometry.coordinates[0], point.geometry.coordinates[1]],
          zoom: Math.max(map.getZoom(), 18),
          duration: 700,
        });
      }
      return;
    }
  }, [activeSpatialStructureId, spatialFeatures]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer(sourceIds.satellite)) return;
    map.setLayoutProperty(
      sourceIds.satellite,
      "visibility",
      basemap === "satellite" ? "visible" : "none",
    );
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = editable && drawMode !== "idle" ? "crosshair" : "";
  }, [drawMode, editable]);

  return (
    <div
      ref={containerRef}
      className="h-full min-h-[560px] w-full"
      aria-label={t("map.canvasLabel")}
    />
  );
}
