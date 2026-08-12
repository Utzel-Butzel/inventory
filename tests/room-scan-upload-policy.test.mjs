import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcileFailedRoomScanCreation,
  roomScanAssetContentDisposition,
  roomScanAssetMimeType,
  roomScanWriteReceipt,
} from "../lib/room-scan-upload-policy.ts";

test("room scan downloads use fixed non-executable MIME types and attachments", () => {
  assert.equal(
    roomScanAssetMimeType("world_map"),
    "application/vnd.apple.arkit.world-map",
  );
  assert.equal(roomScanAssetMimeType("model_usdz"), "model/vnd.usdz+zip");
  assert.equal(roomScanAssetMimeType("guide_image"), "image/jpeg");

  const disposition = roomScanAssetContentDisposition(
    "room.html\r\nX-Injection: yes",
  );
  assert.match(disposition, /^attachment;/);
  assert.equal(disposition.includes("\r"), false);
  assert.equal(disposition.includes("\n"), false);
  assert.equal(disposition.includes("%0D%0A"), true);
});

test("write and replay receipts never expose room-scene read data", () => {
  assert.deepEqual(roomScanWriteReceipt("scan-1", false), {
    id: "scan-1",
    replayed: false,
  });
  assert.deepEqual(roomScanWriteReceipt("scan-1", true), {
    id: "scan-1",
    replayed: true,
  });
  assert.equal("scene" in roomScanWriteReceipt("scan-1", true), false);
});

test("a matching scan proves an ambiguous create committed without deleting assets", async () => {
  let cleanupCalls = 0;
  const result = await reconcileFailedRoomScanCreation({
    scanId: "scan-1",
    roomResourceId: "room-1",
    findScan: async () => ({ id: "scan-1", roomResourceId: "room-1" }),
    cleanupUncommittedAssets: async () => {
      cleanupCalls += 1;
    },
  });

  assert.deepEqual(result, { kind: "committed", scanId: "scan-1" });
  assert.equal(cleanupCalls, 0);
});

test("assets are deleted only when the database proves the create did not commit", async () => {
  let cleanupCalls = 0;
  const result = await reconcileFailedRoomScanCreation({
    scanId: "scan-1",
    roomResourceId: "room-1",
    findScan: async () => null,
    cleanupUncommittedAssets: async () => {
      cleanupCalls += 1;
    },
  });

  assert.deepEqual(result, { kind: "not-committed" });
  assert.equal(cleanupCalls, 1);
});

test("an unavailable commit check preserves assets for later reconciliation", async () => {
  let cleanupCalls = 0;
  const result = await reconcileFailedRoomScanCreation({
    scanId: "scan-1",
    roomResourceId: "room-1",
    findScan: async () => {
      throw new Error("database unavailable");
    },
    cleanupUncommittedAssets: async () => {
      cleanupCalls += 1;
    },
  });

  assert.deepEqual(result, { kind: "unknown" });
  assert.equal(cleanupCalls, 0);
});
