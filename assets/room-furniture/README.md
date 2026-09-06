# Editable room furniture

The current **v2 library contains 42 original models** authored in Blender 5.2.1 LTS through Blender MCP 1.9.1. Twelve additions cover a nightstand, fluted TV console, glazed display cabinet, shoe cabinet, kitchen island, oval dining table, nesting tables, bar stool, walnut lounge chair, right chaise sofa, upholstered bed and daybed.

- `v2/furniture.blend`: complete editable source, with named parts, material nodes and packed textures. Open directly in Blender; models are arranged as a catalog.
- `v2/catalog.png`: rendered overview.
- `../../public/models/room-furniture/v2/furniture.glb`: self-contained web library (approximately 6.5 MB).
- `../../public/models/room-furniture/v2/*.png`: 42 transparent thumbnails.
- `../../public/models/room-furniture/v2/manifest.json`: stable variant IDs, categories, dimensions and generation provenance.

The original v1 `furniture.blend`, preview and web bundle remain available. All models and textures are original project assets under the repository's license; no external furniture assets or paid generation services were used.

## Materials and colors

Wood and fabric use separate 512 px neutral albedo, tangent-space normal and roughness maps. UVs on manufactured panels are projected in metric units so grain and weave are not stretched across a whole table or cabinet. Materials include wood clearcoat, fabric sheen, metals, ceramics and transmissive cabinet glazing.

The glTF material base color and the Blender Multiply node control the tint without baking brown/green into the image. The web color picker changes materials marked `inventoryTintable`; hardware, ceramics, glazing and bedding retain their own finishes. All textures are packed into the blend file and embedded in the GLB.

## Permanent Blender MCP installation on this Mac

- Server executable: `~/.local/share/blender-mcp/blender-mcp`
- Pinned runtime: `~/.local/share/blender-mcp/venv` (`blender-mcp==1.9.1`)
- Blender add-on: `~/Library/Application Support/Blender/5.2/scripts/addons/blender_mcp.py`
- Saved Blender 5.2 preferences enable the add-on. It starts its local listener when Blender opens (127.0.0.1:9876).
- Codex registers the server globally as `blender`. A fresh Codex session loads newly registered tools.
- Telemetry is disabled in both the launcher and the add-on preferences.

Blender must be running with a UI; the upstream add-on intentionally does not listen in background mode. Installation follows [Blender MCP](https://github.com/ahujasid/blender-mcp) and the [Codex MCP configuration](https://developers.openai.com/codex/mcp) instructions.

## Rebuild

Open a dedicated empty Blender scene with the add-on enabled. In the repository root:

```sh
node scripts/blender/mcp-client.mjs
node scripts/blender/mcp-client.mjs scripts/blender/generate-room-furniture.py
node scripts/blender/mcp-client.mjs scripts/blender/render-room-furniture.py
```

The client finds the permanent installation automatically; other machines can supply `BLENDER_MCP_COMMAND` and optionally `BLENDER_PORT`. Generation replaces the `Inventory Furniture` collection. Rendering creates thumbnails, arranges the catalog and saves the editable source. Run both scripts in the same Blender instance.

When publishing a changed library, increment the asset directory and `roomFurnitureLibraryVersion` so browser and completed lighting caches cannot reuse old geometry.

## AI assignment

Every variant is included in the structured AI schema and the category/description catalog sent to the analyzer. Up to twelve balanced synthetic reference thumbnails supplement the catalog, explicitly separated from scan evidence. A subtype selection requires a compatible category, confidence of at least 0.65 and a clear image observation of at least 0.65 confidence. Weak or contradictory choices are discarded. The catalog is a visual approximation fitted to measured dimensions, not a guarantee of exact brand/model recognition. Users review suggestions; manual choices take priority.

## Room appearance and editing

All four lighting modes use neutral tone mapping, the same exposure control and the same stored material properties. Progressive and realistic views now share a path-traced lightmap pipeline at different sample budgets. Their emitters are sized and placed per room in scan coordinates, so a neighbour cannot resize or redirect the primary room's light. Live uses one calibrated, distance-independent daylight approximation and screen-space contact shadows. Rendering traces the visible camera view. Shadow quality and indirect reflections can still differ between solvers. On WebKit, the traced shader omits the additional clearcoat reflection lobe to work around [upstream issue #711](https://github.com/gkjohnson/three-gpu-pathtracer/issues/711); base color, texture, roughness and primary reflections stay intact. The editable Blender/GLB materials retain their clearcoat.

The architecture editor stores per-surface material, color and roughness with the scan revision. Dimensions, transforms and measured polygons remain editable. A wall move carries its associated doors/windows and updates scene bounds; finish-only edits retain geometry and bounds. The floor is independently editable. Manual finishes override accepted AI finishes and survive presentation regeneration. Geometry/material changes invalidate saved lighting.
