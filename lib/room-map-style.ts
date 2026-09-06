import type { StyleSpecification } from "maplibre-gl";

/** Both room maps use the configured provider, with a usable key-free fallback. */
export function roomMapStyle(): StyleSpecification | string {
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim();
  if (!token) {
    return process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim()
      || "https://tiles.openfreemap.org/styles/liberty";
  }
  const accessToken = encodeURIComponent(token);
  return {
    version: 8,
    glyphs: `https://api.mapbox.com/fonts/v1/mapbox/{fontstack}/{range}.pbf?access_token=${accessToken}`,
    sources: {
      "mapbox-streets": {
        type: "raster",
        tiles: [`https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/512/{z}/{x}/{y}?access_token=${accessToken}`],
        tileSize: 512,
        attribution: "© Mapbox © OpenStreetMap",
      },
    },
    layers: [{ id: "mapbox-streets", type: "raster", source: "mapbox-streets" }],
  };
}
