import assert from "node:assert/strict";
import test from "node:test";

import {
  arrangeFloorRooms,
  rotateRoomTransform,
  transformedRoomBounds,
  translateRoomTransform,
} from "../lib/room-floor-layout.ts";

const identity = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

const room = (id, coordinateSpaceId = null, worldFromModel = identity) => ({
  id,
  coordinateSpaceId,
  bounds: { min: [-1, 0, -1], max: [1, 2.5, 1] },
  worldFromModel,
  layoutTransform: null,
});

test("independent legacy rooms are arranged next to each other", () => {
  const layout = arrangeFloorRooms([room("a"), room("b")]);
  const first = transformedRoomBounds(room("a").bounds, layout.transforms.get("a"));
  const second = transformedRoomBounds(room("b").bounds, layout.transforms.get("b"));
  assert.equal(first.min[0], 0);
  assert.equal(second.min[0], first.max[0] + 0.4);
  assert.deepEqual([...layout.automaticRoomIds], ["a", "b"]);
});

test("rooms captured in one coordinate space preserve their relative offsets", () => {
  const right = translateRoomTransform(identity, [3, 0, 0]);
  const layout = arrangeFloorRooms([
    room("a", "shared"),
    room("b", "shared", right),
  ]);
  const first = layout.transforms.get("a");
  const second = layout.transforms.get("b");
  assert.equal(second[12] - first[12], 3);
});

test("saved transforms remain fixed and new rooms are appended after them", () => {
  const fixed = {
    ...room("fixed"),
    layoutTransform: translateRoomTransform(identity, [5, 0, 0]),
  };
  const layout = arrangeFloorRooms([fixed, room("new")]);
  assert.deepEqual(layout.transforms.get("fixed"), fixed.layoutTransform);
  const fixedBounds = transformedRoomBounds(fixed.bounds, fixed.layoutTransform);
  const newBounds = transformedRoomBounds(
    room("new").bounds,
    layout.transforms.get("new"),
  );
  assert.equal(newBounds.min[0], fixedBounds.max[0] + 0.4);
});

test("room transforms can be nudged and rotated without moving their origin", () => {
  const moved = translateRoomTransform(identity, [2, 0, -1]);
  const rotated = rotateRoomTransform(moved, Math.PI / 2);
  assert.deepEqual(rotated.slice(12, 15), [2, 0, -1]);
  assert.ok(Math.abs(rotated[0]) < 1e-12);
  assert.ok(Math.abs(rotated[2] + 1) < 1e-12);
});
