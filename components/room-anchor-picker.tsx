"use client";
import { useEffect, useRef } from "react";
import {
  Map,
  Marker,
  NavigationControl,
  type GeoJSONSource,
} from "@/lib/maplibre-runtime";
import type { RoomScene, SpatialMatrix4 } from "@/lib/room-scene-contract";
import { roomSceneFootprintToGeoJson } from "@/lib/spatial-georeference";
import { roomSceneCenterPosition } from "@/lib/room-scene-editor";
import { roomWorldDeltaTransform } from "@/lib/room-floor-layout";
import { roomMapStyle } from "@/lib/room-map-style";
export function RoomAnchorPicker({
  scene,
  layoutTransform,
  latitude,
  longitude,
  heading,
  onChange,
}: {
  scene: RoomScene;
  layoutTransform?: SpatialMatrix4 | null;
  latitude: number | null;
  longitude: number | null;
  heading: number;
  onChange: (latitude: number, longitude: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const change = useRef(onChange);
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<Marker | null>(null);
  useEffect(() => {
    change.current = onChange;
  }, [onChange]);
  useEffect(() => {
    if (!host.current) return;
    const map = new Map({
      container: host.current,
      style: roomMapStyle(),
      center: [longitude ?? 10.4, latitude ?? 51.1],
      zoom: latitude === null ? 4 : 18,
    });
    mapRef.current = map;
    const marker = new Marker({
      draggable: true,
      rotationAlignment: "map",
      color: "#6366f1",
    });
    markerRef.current = marker;
    if (latitude !== null && longitude !== null)
      marker.setLngLat([longitude, latitude]).addTo(map);
    const choose = (lat: number, lng: number) => {
      marker.setLngLat([lng, lat]).addTo(map);
      change.current(lat, lng);
    };
    map.on("click", (event) => choose(event.lngLat.lat, event.lngLat.lng));
    marker.on("dragend", () => {
      const p = marker.getLngLat();
      change.current(p.lat, p.lng);
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    return () => {
      marker.remove();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Initial coordinates only; subsequent edits move the marker without recreating the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (
      latitude === null ||
      longitude === null ||
      Math.abs(latitude) > 85 ||
      Math.abs(longitude) > 180 ||
      !mapRef.current ||
      !markerRef.current
    )
      return;
    markerRef.current
      .setLngLat([longitude, latitude])
      .setRotation(heading)
      .addTo(mapRef.current);
    if (
      mapRef.current.getZoom() < 16 ||
      !mapRef.current.getBounds().contains([longitude, latitude])
    )
      mapRef.current.easeTo({ center: [longitude, latitude], zoom: 18 });
  }, [latitude, longitude, heading]);
  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      latitude === null ||
      longitude === null ||
      Math.abs(latitude) > 85 ||
      Math.abs(longitude) > 180
    )
      return;
    const anchor = {
      latitude,
      longitude,
      headingDegrees: heading,
      localReferencePosition: roomSceneCenterPosition(scene, layoutTransform),
      capturedAt: new Date().toISOString(),
      source: "manual" as const,
    };
    const feature = roomSceneFootprintToGeoJson(
      scene,
      anchor,
      {},
      roomWorldDeltaTransform(scene.worldFromModel, layoutTransform),
    );
    const update = () => {
      if (!map.isStyleLoaded()) return;
      const source = map.getSource("preview-room") as GeoJSONSource | undefined;
      if (source) source.setData(feature);
      else {
        map.addSource("preview-room", { type: "geojson", data: feature });
        map.addLayer({
          id: "preview-room-fill",
          type: "fill",
          source: "preview-room",
          paint: { "fill-color": "#6366f1", "fill-opacity": 0.3 },
        });
        map.addLayer({
          id: "preview-room-line",
          type: "line",
          source: "preview-room",
          paint: { "line-color": "#4f46e5", "line-width": 2 },
        });
      }
    };
    update();
    map.on("load", update);
    return () => {
      map.off("load", update);
    };
  }, [scene, layoutTransform, latitude, longitude, heading]);
  return (
    <div
      ref={host}
      className="h-52 overflow-hidden rounded-lg border border-border"
    />
  );
}
