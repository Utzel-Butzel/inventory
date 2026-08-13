import type { SpatialMatrix4, SpatialVector3 } from "@/lib/room-scene-contract";

export type RoomLayoutInput = {
  id: string;
  coordinateSpaceId?: string | null;
  bounds: { min: SpatialVector3; max: SpatialVector3 };
  worldFromModel: SpatialMatrix4;
  layoutTransform?: SpatialMatrix4 | null;
};

export type RoomLayoutResult = {
  transforms: Map<string, SpatialMatrix4>;
  automaticRoomIds: Set<string>;
};

const identity: SpatialMatrix4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

export function multiplySpatialMatrices(
  left: readonly number[],
  right: readonly number[],
): SpatialMatrix4 {
  const result = Array.from({ length: 16 }, () => 0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let index = 0; index < 4; index += 1) {
        result[column * 4 + row] +=
          (left[index * 4 + row] ?? 0) *
          (right[column * 4 + index] ?? 0);
      }
    }
  }
  return result as SpatialMatrix4;
}

export function translateRoomTransform(
  transform: readonly number[],
  delta: SpatialVector3,
): SpatialMatrix4 {
  const translation = [...identity] as SpatialMatrix4;
  translation[12] = delta[0];
  translation[13] = delta[1];
  translation[14] = delta[2];
  return multiplySpatialMatrices(translation, transform);
}

export function rotateRoomTransform(
  transform: readonly number[],
  radians: number,
): SpatialMatrix4 {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const rotation: SpatialMatrix4 = [
    cosine, 0, -sine, 0,
    0, 1, 0, 0,
    sine, 0, cosine, 0,
    0, 0, 0, 1,
  ];
  const translation: SpatialVector3 = [
    transform[12] ?? 0,
    transform[13] ?? 0,
    transform[14] ?? 0,
  ];
  const withoutTranslation = [...transform] as SpatialMatrix4;
  withoutTranslation[12] = 0;
  withoutTranslation[13] = 0;
  withoutTranslation[14] = 0;
  const rotated = multiplySpatialMatrices(rotation, withoutTranslation);
  rotated[12] = translation[0];
  rotated[13] = translation[1];
  rotated[14] = translation[2];
  return rotated;
}

const transformPoint = (
  matrix: readonly number[],
  point: SpatialVector3,
): SpatialVector3 => [
  (matrix[0] ?? 0) * point[0] +
    (matrix[4] ?? 0) * point[1] +
    (matrix[8] ?? 0) * point[2] +
    (matrix[12] ?? 0),
  (matrix[1] ?? 0) * point[0] +
    (matrix[5] ?? 0) * point[1] +
    (matrix[9] ?? 0) * point[2] +
    (matrix[13] ?? 0),
  (matrix[2] ?? 0) * point[0] +
    (matrix[6] ?? 0) * point[1] +
    (matrix[10] ?? 0) * point[2] +
    (matrix[14] ?? 0),
];

export function transformedRoomBounds(
  bounds: RoomLayoutInput["bounds"],
  transform: readonly number[],
) {
  const corners: SpatialVector3[] = [];
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        corners.push(transformPoint(transform, [x, y, z]));
      }
    }
  }
  return {
    min: [
      Math.min(...corners.map((point) => point[0])),
      Math.min(...corners.map((point) => point[1])),
      Math.min(...corners.map((point) => point[2])),
    ] as SpatialVector3,
    max: [
      Math.max(...corners.map((point) => point[0])),
      Math.max(...corners.map((point) => point[1])),
      Math.max(...corners.map((point) => point[2])),
    ] as SpatialVector3,
  };
}

const unionBounds = (
  entries: Array<{ min: SpatialVector3; max: SpatialVector3 }>,
) => ({
  min: [
    Math.min(...entries.map((entry) => entry.min[0])),
    Math.min(...entries.map((entry) => entry.min[1])),
    Math.min(...entries.map((entry) => entry.min[2])),
  ] as SpatialVector3,
  max: [
    Math.max(...entries.map((entry) => entry.max[0])),
    Math.max(...entries.map((entry) => entry.max[1])),
    Math.max(...entries.map((entry) => entry.max[2])),
  ] as SpatialVector3,
});

/**
 * Preserves RoomPlan's relative transforms for scans captured in one AR
 * session. Independent scans are placed in compact rows, so legacy rooms are
 * immediately useful before a person fine-tunes their doorway alignment.
 */
export function arrangeFloorRooms(
  rooms: readonly RoomLayoutInput[],
  gap = 0.4,
): RoomLayoutResult {
  const transforms = new Map<string, SpatialMatrix4>();
  const automaticRoomIds = new Set<string>();
  const fixedBounds: Array<{ min: SpatialVector3; max: SpatialVector3 }> = [];

  for (const room of rooms) {
    if (!room.layoutTransform) continue;
    transforms.set(room.id, [...room.layoutTransform] as SpatialMatrix4);
    fixedBounds.push(transformedRoomBounds(room.bounds, room.layoutTransform));
  }

  const automatic = rooms.filter((room) => !room.layoutTransform);
  const groups = new Map<string, RoomLayoutInput[]>();
  for (const room of automatic) {
    const key = room.coordinateSpaceId
      ? `coordinate:${room.coordinateSpaceId}`
      : `room:${room.id}`;
    const current = groups.get(key);
    if (current) current.push(room);
    else groups.set(key, [room]);
  }

  let cursor = fixedBounds.length
    ? Math.max(...fixedBounds.map((bounds) => bounds.max[0])) + gap
    : 0;
  for (const group of groups.values()) {
    const capturedBounds = unionBounds(
      group.map((room) =>
        transformedRoomBounds(room.bounds, room.worldFromModel),
      ),
    );
    const shiftX = cursor - capturedBounds.min[0];
    const shiftZ = -(capturedBounds.min[2] + capturedBounds.max[2]) / 2;
    for (const room of group) {
      transforms.set(
        room.id,
        translateRoomTransform(room.worldFromModel, [shiftX, 0, shiftZ]),
      );
      automaticRoomIds.add(room.id);
    }
    cursor += capturedBounds.max[0] - capturedBounds.min[0] + gap;
  }

  return { transforms, automaticRoomIds };
}
