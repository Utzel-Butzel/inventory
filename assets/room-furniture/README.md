# Furniture library

Thirty original furniture and fixture models, generated with **Blender MCP 1.9.1** in **Blender 5.2.1 LTS**. The models use beveled edges, separate panels/cushions/handles, and embedded wood/fabric PBR textures. No external furniture assets or paid generation services are used.

- `furniture.blend`: editable source scene, arranged as a catalog.
- `catalog.png`: overview rendered in Blender.
- `public/models/room-furniture/v1/furniture.glb`: self-contained web bundle (about 3.3 MB).
- `public/models/room-furniture/v1/*.png`: transparent model thumbnails.
- `public/models/room-furniture/v1/manifest.json`: model identifiers, dimensions and generation provenance.

The assets are original project assets under the repository's license.

## Rebuild through Blender MCP

Open a separate, empty Blender instance with the Blender MCP addon running. From the repository root, set `BLENDER_MCP_COMMAND` to the installed `blender-mcp` executable (and `BLENDER_PORT` if using a non-default port), then run:

```sh
node scripts/blender/mcp-client.mjs scripts/blender/generate-room-furniture.py
node scripts/blender/mcp-client.mjs scripts/blender/render-room-furniture.py
```

The first script replaces only the `Inventory Furniture` collection and exports the bundle. The second creates thumbnails and saves the editable source. Run both against the same Blender instance. The MCP client disables telemetry for this authoring session.

When publishing a changed asset library, use a new version directory and update `roomFurnitureLibraryVersion` and `roomFurnitureLibraryUrl` in the catalog so completed lighting caches cannot reuse old geometry.

## ARKit regeneration

The room editor's “Regenerate from ARKit data” action updates presentation models from the persisted scan's object categories and measured boxes. It preserves the current architectural geometry, room splits, transforms, manual appearance settings, map anchor and AI review decisions. It is a presentation rebuild, not a new physical scan or recovery of previously replaced scan geometry. Unsupported ARKit categories retain the procedural fallback.

AI analysis can suggest a catalog variant when the photo clearly supports its construction. Suggestions remain reviewable, and conflicting or weakly supported subtype selections are discarded. Manual model choices take priority over AI suggestions.
