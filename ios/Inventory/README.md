# Inventory for iOS

Native SwiftUI companion app for the Inventory server in this repository. It
uses AVFoundation directly for low-latency photos and QR/barcode recognition;
WebRTC is not required for app-to-server uploads.

## Features

- One native rear-camera session for fast still photos and code recognition
- QR, EAN-8/EAN-13, UPC-E, Code 128, Data Matrix, PDF417, and Aztec scanning
- Exact lookup by resource UUID/link, SKU, or serial number
- Create a new item from an unknown code and continue in the same photo flow
- Capture or select up to 12 photos, downsampled with ImageIO to 2,200 px JPEG
- Persistent, crash-safe upload pipeline: create → media → analysis → optional cover
- Server-approved image-model selection, remembered separately for each server
- Automatic retry with backoff and end-to-end idempotency for every queued stage
- Inventory search, authenticated image loading, details, and manual editing
- One-tap stock receipts plus confirmed stock issues from a scanned item
- Camera-based part counting with confidence, manual correction, and reviewed stock +/-
- Email/password login with a device token stored in Keychain
- Manual API token as an optional expert login
- Optional GPS coordinates for new captures
- Continuous LiDAR multi-room capture with RoomPlan `CapturedStructure` USDZ models
- Relocalized item capture with automatic room detection and scene-depth/plane measurement
- Spatial placement persisted in the crash-safe item upload pipeline before media analysis

## Run it

1. Start a reachable Inventory server and apply all database migrations.
2. Open `Inventory.xcodeproj` in Xcode 26 or newer.
3. Select the `Inventory` target, choose your Apple development team,
   and run on a LiDAR-capable iPhone with iOS 17 or newer (a recent Pro model).
4. Enter the deployment root URL and sign in with email and password. A manual
   API token remains available under the expert option.

Use HTTPS for devices. Plain HTTP is accepted only for `localhost`, loopback,
and `.local` development hosts; bearer tokens are never sent over public HTTP.
The Simulator can build and exercise API/UI behavior,
but camera and scanner acceptance must be done on a physical iPhone.

## Spatial rooms

Use the **Räume** tab to name a structure and floor, then scan every connected
room without leaving the capture flow. **Raum fertig · weiter** processes the
current room while keeping the shared `ARSession` alive; after the final room,
`StructureBuilder` creates a `CapturedStructure`. Each room remains a separate,
versioned scan for backwards compatibility, while all scans in the batch carry
the same `structureId`, `coordinateSpaceId`, byte-identical `ARWorldMap`, floor
metadata, and optional georeference. The combined structure USDZ is attached to
the first room upload so it is not uploaded repeatedly.

The optional map anchor pairs a fresh GPS/true-heading observation with the
current AR camera pose. `headingDegrees` is the clockwise true-north bearing of
the local ARKit `-Z` axis; `localReferencePosition` records the camera position
where that pairing occurred. An entrance/QR marker code can be stored as a
re-entry affordance. With map anchoring enabled, the scan waits for a fresh
paired GPS/compass reading and offers a retry if either sensor is unavailable.
GPS and compass only locate and orient the structure on the map—the shared
world map remains responsible for indoor precision.

Use **Raum/Etage hinzufügen** to preserve the structure while starting a fresh
coordinate space for another capture batch. Use **Neu scannen** for a strict
single-room replacement; it does not duplicate the other rooms or their
resources.

During normal item capture, tap **Im Raum** and choose a structure (or an older
standalone room). Capture remains disabled until ARKit has relocalized the saved
coordinate space. The app then compares the camera position with oriented
RoomPlan floor footprints and changes the active room automatically. Expanded
exit bounds and several confirming frames prevent flicker around doorways; a
manual room menu remains available when containment is ambiguous. LiDAR scene
depth is used first, with a detected/estimated plane as fallback. The resulting
photo continues through the normal create → placement → media → analysis →
cover queue. A partial rescan intentionally receives a new `coordinateSpaceId`,
so scans from unrelated AR origins are never mixed for automatic room detection.

RoomPlan availability is checked at runtime. The simulator can exercise API and
SwiftUI behavior, but room scanning, relocalization, scene depth, and positional
accuracy must be verified on the physical LiDAR device.

## Recognized resource codes

The app and server currently recognize:

```text
3f2504e0-4f89-41d3-9a0c-0305e82c3301
inventory:3f2504e0-4f89-41d3-9a0c-0305e82c3301
inventory://resource/3f2504e0-4f89-41d3-9a0c-0305e82c3301
https://inventory.example/inventory/3f2504e0-4f89-41d3-9a0c-0305e82c3301
```

Other values are resolved exactly against `sku` and then `serialNumber`.
Unknown values use the new item's SKU up to 80 characters and its serial-number
field up to 180 characters. External URLs are never opened automatically.

## Upload behavior

Before a job starts, prepared JPEGs are copied to Application Support. The job
manifest and backup record each completed server stage, so a relaunch verifies
the complete local photo set before it resumes. Multipart bodies are streamed
to a temporary file instead of being assembled in memory. Jobs are processed
one at a time because the current server buffers multipart forms and stores
files sequentially.

Each job is pinned to the canonical server origin and carries stable operation
IDs for resource creation, media, analysis, and cover generation. The matching
API routes persist these idempotency keys, so a lost response can be retried
without creating a second item, duplicate media, or another paid AI operation.
The selected cover model is copied into the queued job as well, so changing the
app preference does not alter work that is already waiting to upload.
Transient network and rate-limit errors use bounded exponential backoff.

## Photo counting

Capture, code scanning, and photo counting share one 3:4 camera viewport and
one running capture session. The bottom mode strip can be tapped or swiped like
the native iOS Camera modes. The resource detail opens that same camera directly
in **Zählen** when the signed-in token has the `ai` scope.

The app sends one downsampled JPEG as multipart field
`image` and the optional, 240-character item description as `itemHint` to
`POST /api/v1/ai/count`. The response contains `count`, `confidence`,
`detectedItem`, `isExact`, `explanation`, `warnings`, `markers` with one
normalized, material-bound point per counted item, and `model`. The app overlays
those points on the full, uncropped photo in the same 3:4 viewport.

The source photo remains only in the temporary directory for review and is
removed when the sheet closes or another photo is taken. The detected count is
editable before it is booked as a stock receipt or confirmed stock issue.

## Tests

Build the app without signing:

```bash
xcodebuild \
  -project Inventory.xcodeproj \
  -scheme Inventory \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/inventory-derived \
  CODE_SIGNING_ALLOWED=NO build
```

Unit tests cover scanner payload parsing, sparse PATCH encoding, file-backed
multipart construction, server URL safety, and queue recovery after interrupted
photo imports. Run them from Xcode or with an installed iOS Simulator destination.
