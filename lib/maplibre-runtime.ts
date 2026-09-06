"use client";

import { getVersion, setWorkerUrl } from "maplibre-gl";

// MapLibre 6 workers import a sibling module. Serve both together instead of
// letting Next.js turn only the worker entry point into a hashed asset.
setWorkerUrl(`/vendor/maplibre/${getVersion()}/maplibre-gl-worker.mjs`);

export * from "maplibre-gl";
