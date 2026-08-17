# Inventory for iOS

Native SwiftUI companion app for the Inventory server in this repository. It
uses AVFoundation directly for low-latency photos and QR/barcode recognition;
WebRTC is not required for app-to-server uploads.

## Features

- One native rear-camera session for fast still photos, code recognition, and
  visual inventory matching
- QR, EAN-8/EAN-13, UPC-E, Code 128, Data Matrix, PDF417, and Aztec scanning
- Exact lookup by resource UUID/link, SKU, or serial number
- Create a new item from an unknown code and continue in the same photo flow
- Capture or select up to 12 photos, downsampled with ImageIO to a configurable
  largest-side JPEG limit (1,024, 1,600, 2,200 by default, or 4,096 px)
- Persistent, crash-safe upload pipeline: create → media → analysis → optional cover
- Server-approved image-model selection, remembered separately for each server
- Automatic retry with backoff and end-to-end idempotency for every queued stage
- Inventory search, authenticated image loading, details, and manual editing
- One-tap stock receipts plus confirmed stock issues from a scanned item
- Camera-based part counting with confidence, manual correction, and reviewed stock +/-
- Camera-based object recognition with ranked matches to existing inventory items
- Email/password login with a device token stored in Keychain
- Manual API token as an optional expert login
- Organization discovery and switching with a remembered selection per server
- Organization-pinned uploads and media caches that cannot cross workspace boundaries
- Optional GPS coordinates for new captures
- Continuous LiDAR multi-room capture with RoomPlan `CapturedStructure` USDZ models
- Bounded RGB room keyframes with ARKit pose, intrinsics, and shared coordinates
- Relocalized item capture with automatic room detection and scene-depth/plane measurement
- Vision-assisted photo matching against stored room views as localization evidence
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

While RoomPlan is running, the app samples RGB keyframes from that same
`ARSession` without replacing RoomPlan's delegate. It keeps only normal-tracking,
sufficiently sharp views separated by time plus camera translation/rotation,
with a hard limit of 32 images and 24 MB per room. Each JPEG carries its ARKit
timestamp, native image orientation, scaled pinhole intrinsics, and the
column-major `worldFromCamera` transform in the scan's `coordinateSpaceId`.

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

For item photos, the app downloads at most eight high-quality keyframes per
room (24 per connected structure), immediately converts them to Vision feature
prints, and releases the JPEG bytes. A new upright item photo is compared only
with references belonging to the room selected by the relocalized AR session.
A distinctive match and camera-position agreement are saved as coarse
`localizationEvidence`; the ARWorldMap and live AR pose remain authoritative.
Without a live AR pose, the matcher can return the best reference keyframe's
stored `worldFromCamera` as a coarse room/place estimate. Global feature-print
similarity alone is deliberately not presented as a new six-degree-of-freedom
pose estimate.

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

The iOS settings keep two validated, device-local image-size preferences. New
inventory photos and Object Capture representative images use a maximum largest
side of 1,024, 1,600, 2,200 (the default), or 4,096 pixels. Images below the
selected limit are not enlarged. Recognition, counting, and spatial keyframes
retain their own fixed processing bounds because they are transient or carry
camera-calibration metadata.

Generated AI covers use a separate 1,024 (the default), 2,048, or 4,096-pixel
maximum. Both the selected cover model and generated-image size are copied into
each new upload job, so later settings changes do not alter a queued retry.

The AI settings also support separate prompt overrides for inventory analysis,
regular covers, and transparent Object Capture covers. Overrides are kept per
server, organization, and signed-in account; an empty prompt uses the server's
dynamic default. New upload jobs snapshot their prompts so retries keep the
same idempotent request.

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
Transient network and rate-limit errors use bounded exponential backoff.

## Photo counting

Capture, code scanning, and photo counting share one 3:4 camera viewport and
one running capture session. The bottom mode strip can be tapped or swiped like
the native iOS Camera modes. The resource detail opens that same camera directly
in **Zählen** when the signed-in token has the `ai` scope.

The app sends one downsampled JPEG as multipart field
`image`, the optional 240-character item description as `itemHint`, and the
inventory UUID as `itemId` to
`POST /api/v1/ai/count`. The server keeps its Replicate credential private and
runs the configured SAM 3 counter. If the community model is cold, the app
polls the same signed prediction until its server-provided deadline and retries
transient poll failures. A stable idempotency key makes a lost start response
safe to retry; closing the view cancels local waiting. The response contains
`count`, `confidence`,
`detectedItem`, `isExact`, `explanation`, `warnings`, `markers` with one
normalized bounding-box center per counted item, and `model`. The app overlays
those points on the full, uncropped photo in the same 3:4 viewport.

The source photo remains only in the temporary directory for review and is
removed when the sheet closes or another photo is taken. The detected count is
editable before it is booked as a stock receipt or confirmed stock issue.

## Photo recognition

The shared camera has a fourth **Erkennen** mode between **Scannen** and
**Zählen**. It sends one downsampled JPEG to `POST /api/v1/ai/recognize` with a
stable idempotency key. The server first describes the dominant object, builds
a bounded text shortlist from inventory metadata, and then compares the query
with available reference photos. Results contain up to five ranked inventory
items with confidence and matching evidence.

Recognition is advisory: the app never opens or changes an item automatically.
The user selects a proposed match to open its existing detail view, and a weak
or ambiguous result is clearly marked for review. The query JPEG is transient,
is not attached to an inventory item, and is deleted locally when the camera
closes or a new photo is taken. Server access requires both `ai.use` and direct
`inventory.read` permission.

## TestFlight deployment

Fastlane is pinned through the root `Gemfile`, and all commands run from the
repository root. The initial setup needs Ruby 3.2 or newer with Bundler (Ruby
3.3 or newer is recommended), Xcode 26 or newer, and an Apple Distribution
signing identity for team `6CXYQL7FXP`. Automatic signing also expects the team
to be signed in and configured in Xcode. Xcode is allowed to refresh the
matching App Store provisioning profile during IPA export; this is necessary
whenever the team's Apple Distribution certificate changes.

Create an App Store Connect Team API key with the **App Manager** role. Download
and back up its `.p8` file immediately because Apple only offers it once. Keep
the key outside this repository, then prepare the ignored local environment:

```bash
cp fastlane/.env.example fastlane/.env
gem install bundler -v 4.0.8
npm run fastlane:install
```

Fill in the key ID, issuer ID, and absolute `.p8` path in `fastlane/.env`. A
Base64-encoded key is supported as an alternative for CI secret stores. Verify
the local project and shared Xcode scheme without uploading anything:

```bash
npm run ios:check
```

Create a signed IPA under `build/ios` without contacting TestFlight:

```bash
npm run ios:build
```

Deploy the next build to TestFlight with either equivalent command:

```bash
npm run deploy
npm run deploy:ios
```

The deploy lane reads the latest build number for the current marketing version
from TestFlight and uses the next integer only for that `xcodebuild` invocation;
it does not edit `project.pbxproj`. Set `IOS_BUILD_NUMBER` only when an external
system allocates build numbers, and do not run two deployments concurrently.
`TESTFLIGHT_CHANGELOG` optionally supplies the "What to Test" text. The command
uploads for internal TestFlight use and never submits the app for App Review or
notifies external testers.

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
