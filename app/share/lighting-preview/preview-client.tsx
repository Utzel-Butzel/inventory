"use client";

import { RoomSceneCanvas } from "@/components/room-scene-canvas";
import type { ClientRoomSceneManifest } from "@/lib/client-types";

const identity = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

const transform = (
  x: number,
  y: number,
  z: number,
  rotationY = 0,
) => {
  const cosine = Math.cos(rotationY);
  const sine = Math.sin(rotationY);
  return [
    cosine, 0, -sine, 0,
    0, 1, 0, 0,
    sine, 0, cosine, 0,
    x, y, z, 1,
  ];
};

const manifest: ClientRoomSceneManifest = {
  room: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Ray-tracing test room",
    description: "Temporary visual QA room",
  },
  scan: {
    id: "22222222-2222-4222-8222-222222222222",
    revision: 1,
    status: "active",
    capturedAt: "2026-08-21T12:00:00.000Z",
    deviceModel: "QA",
    assets: [],
    scene: {
      schemaVersion: 1,
      coordinateSystem: "arkit-right-handed-y-up",
      units: "meter",
      matrixOrder: "column-major",
      worldFromModel: [...identity],
      webFromWorld: [...identity],
      bounds: { min: [-3, 0, -2.5], max: [3, 2.8, 2.5] },
      surfaces: [
        {
          id: "30000000-0000-4000-8000-000000000001",
          category: "floor",
          dimensions: [6, 5, 0],
          transform: [
            1, 0, 0, 0,
            0, 0, 1, 0,
            0, 1, 0, 0,
            0, 0, 0, 1,
          ],
          confidence: "high",
        },
        {
          id: "30000000-0000-4000-8000-000000000002",
          category: "wall",
          dimensions: [6, 2.8, 0],
          transform: transform(0, 1.4, -2.5),
          confidence: "high",
        },
        {
          id: "30000000-0000-4000-8000-000000000003",
          category: "wall",
          dimensions: [6, 2.8, 0],
          transform: transform(0, 1.4, 2.5, Math.PI),
          confidence: "high",
        },
        {
          id: "30000000-0000-4000-8000-000000000004",
          category: "wall",
          dimensions: [5, 2.8, 0],
          transform: transform(-3, 1.4, 0, Math.PI / 2),
          confidence: "high",
        },
        {
          id: "30000000-0000-4000-8000-000000000005",
          category: "wall",
          dimensions: [5, 2.8, 0],
          transform: transform(3, 1.4, 0, -Math.PI / 2),
          confidence: "high",
        },
        {
          id: "30000000-0000-4000-8000-000000000006",
          category: "window",
          dimensions: [2.4, 1.5, 0],
          transform: transform(-0.55, 1.72, -2.5),
          confidence: "high",
        },
      ],
      objects: [
        {
          id: "40000000-0000-4000-8000-000000000001",
          category: "table",
          dimensions: [1.9, 0.78, 0.95],
          transform: transform(-0.25, 0.39, -0.15, -0.08),
          confidence: "high",
        },
        {
          id: "40000000-0000-4000-8000-000000000002",
          category: "chair",
          dimensions: [0.58, 0.95, 0.62],
          transform: transform(-0.25, 0.475, 0.95, Math.PI),
          confidence: "high",
        },
        {
          id: "40000000-0000-4000-8000-000000000003",
          category: "storage",
          dimensions: [1.25, 1.8, 0.42],
          transform: transform(2.25, 0.9, -1.85, Math.PI),
          confidence: "high",
        },
        {
          id: "40000000-0000-4000-8000-000000000004",
          category: "sofa",
          dimensions: [1.8, 0.82, 0.82],
          transform: transform(-1.95, 0.41, 1.75, 0),
          confidence: "high",
        },
      ],
    },
  },
  placements: [],
};

export function LightingPreview() {
  return (
    <main className="h-dvh bg-surface p-4">
      <div className="size-full overflow-hidden rounded-2xl border border-border">
        <RoomSceneCanvas
          manifest={manifest}
          selectedResourceId={null}
          onSelectResource={() => undefined}
        />
      </div>
    </main>
  );
}
