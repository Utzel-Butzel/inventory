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
- Automatic retry with backoff and end-to-end idempotency for every queued stage
- Inventory search, authenticated image loading, details, and manual editing
- One-tap stock receipts plus confirmed stock issues from a scanned item
- Camera-based part counting with confidence, manual correction, and reviewed stock +/-
- Email/password login with a device token stored in Keychain
- Manual API token as an optional expert login
- Optional GPS coordinates for new captures

## Run it

1. Start a reachable Inventory server and apply all database migrations.
2. Open `Inventory.xcodeproj` in Xcode 26 or newer.
3. Select the `Inventory` target, choose your Apple development team,
   and run on an iPhone with iOS 17 or newer.
4. Enter the deployment root URL and sign in with email and password. A manual
   API token remains available under the expert option.

Use HTTPS for devices. Plain HTTP is accepted only for `localhost`, loopback,
and `.local` development hosts; bearer tokens are never sent over public HTTP.
The Simulator can build and exercise API/UI behavior,
but camera and scanner acceptance must be done on a physical iPhone.

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
Transient network and rate-limit errors use bounded exponential backoff.

## Photo counting

The resource detail exposes **Teile per Foto zählen** when the signed-in token
has the `ai` scope. The app sends one downsampled JPEG as multipart field
`image` and the optional, 240-character item description as `itemHint` to
`POST /api/v1/ai/count`. The response contains `count`, `confidence`,
`detectedItem`, `isExact`, `explanation`, `warnings`, and `model`.

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
