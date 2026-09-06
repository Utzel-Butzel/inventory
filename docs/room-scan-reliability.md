# Room scan upload and lifecycle

## Multipart failure

The old `/:organizationId/:path*` Proxy matcher also matched
`/api/v1/room-scans`. The installed Next.js body-cloning implementation in
`node_modules/next/dist/server/body-streams.js` buffers at most 10 MiB by
default. A larger multipart upload loses its closing boundary. Consequently,
`request.formData()` throws before room count, structure metadata, or scene
validation runs, producing `Invalid multipart room scan upload.`

`tests/proxy-rewrite-context.test.mjs` reproduces this with one 11 MiB room
model: parsing the intact body succeeds; parsing its actual Next.js proxy clone
fails. API routes now bypass the page Proxy. API authentication and the bounded
room upload size checks remain in the route handler. Server Actions' separate
`bodySizeLimit` does not fix this problem.

This explains the reported error path; the exact failed production request was
not available for inspection. Additional reverse proxies must also permit the
configured room upload size.

## Capture and upload behavior

- One room is valid in the multi-room flow. The user can finish between rooms,
  without starting a dummy final room.
- Pause keeps the active RoomPlan capture session alive and pauses its ARSession.
  Resume runs the same AR configuration without resetting tracking. Moving the
  app out of the foreground switches the UI to paused.
- Saving no longer requires ARKit's `.mapped` status. If a world map cannot be
  exported, geometry can still upload; existing photo/manual localization
  fallback handles the absent world map.
- When RoomPlan cannot merge partial rooms, each room receives a separate
  coordinate-space identity. They still belong to the same building, but are
  not presented as a verified connected layout.
- Discarding the current room retains previously processed rooms and waits for
  the discarded pass to end before another pass can start. Closing the entire
  capture cancels processing and deletes its local artifacts.
- Before network writes, processed drafts and their immutable scan IDs are
  checkpointed in Application Support. Resource IDs and acknowledged uploads
  are checkpointed as the upload progresses. Retrying reuses IDs and skips
  acknowledged uploads.
- Saved uploads can be reopened from the room library after app restart. They
  are scoped to server, organization, and principal; a different context cannot
  upload or save them into its own queue. Artifact URLs are rebased when loading,
  including after an iOS app-container relocation.

## Deliberate continuation boundary

Persistent checkpoints contain uploadable scenes/assets, **not the internal
state of RoomPlan's active room detector**. They resume uploads after closing
the app. Continuing the same in-progress camera capture works only while that
RoomPlan session remains alive. After finishing/closing a capture, users can
add rooms to the building or rescan an existing room; this does not incrementally
merge new observations into that room's old geometry.

Apple documents [resuming structure scans using an ARWorldMap](https://developer.apple.com/documentation/roomplan/scanning-the-rooms-of-a-single-structure).
Extending this to durable incremental capture requires storing native
CapturedRoom data, restoring/relocalizing the world map, and validating how
overlapping partial passes are combined on a real device. This change does not
claim to implement that workflow.

## Validation

- Proxy tests include the actual >10 MiB truncation reproduction and verify
  that organization page rewrites still work.
- Existing room scene suite: 130 tests.
- Targeted iOS suites: MultipartBuilderTests, SpatialRoomLifecycleTests,
  SpatialRoomSceneContractTests, SpatialScanDraftStoreTests.
- TypeScript type check and targeted ESLint checks.

Before release, test on a LiDAR iPhone: scan one room using the multi-room flow;
save before all walls are mapped; pause/resume in place and after backgrounding;
discard the second room and save the first; finish between rooms; interrupt an
upload, close/reopen the app, and retry without duplicate resources. Verify
that partial scans without a world map use the existing localization fallback.

The server fix requires a web deployment. Capture and local upload recovery
require an updated iOS build. Neither deployment is performed by this change.
