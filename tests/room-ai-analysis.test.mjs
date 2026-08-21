import assert from "node:assert/strict";
import test from "node:test";

import { buildRoomAiAnalysis } from "../lib/room-ai-analysis.ts";

const matrix = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];
const frameId = "11111111-1111-4111-8111-111111111111";
const missingFrameId = "22222222-2222-4222-8222-222222222222";

const scene = {
  schemaVersion: 1,
  coordinateSystem: "arkit-right-handed-y-up",
  units: "meter",
  matrixOrder: "column-major",
  worldFromModel: matrix,
  webFromWorld: matrix,
  bounds: { min: [-2, 0, -2], max: [2, 3, 2] },
  surfaces: [{
    id: "33333333-3333-4333-8333-333333333333",
    category: "wall",
    dimensions: [4, 3, 0.1],
    transform: matrix,
    confidence: "high",
  }],
  objects: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      category: "table",
      dimensions: [1, 0.8, 1],
      transform: matrix,
      confidence: "high",
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      category: "chair",
      dimensions: [0.5, 1, 0.5],
      transform: matrix,
      confidence: "high",
    },
    {
      id: "66666666-6666-4666-8666-666666666666",
      category: "chair",
      dimensions: [0.5, 1, 0.5],
      transform: matrix,
      confidence: "high",
    },
  ],
};

test("grounds only unique RoomPlan categories and keeps evidence within analyzed frames", () => {
  let id = 7;
  const analysis = buildRoomAiAnalysis({
    scene,
    keyframeIds: [frameId],
    model: "vision-test",
    analyzedAt: "2026-08-21T10:00:00.000Z",
    createId: () => `${id++}`.repeat(8).slice(0, 8) + "-7777-4777-8777-777777777777",
    detection: {
      summary: "White walls and several pieces of furniture.",
      surfaceAppearances: [
        {
          surfaceCategory: "wall",
          colorHex: "#f2f0eb",
          colorName: "Warm white",
          material: "paint",
          roughness: 0.86,
          confidence: 0.9,
          evidenceKeyframeIds: [frameId, missingFrameId],
        },
        {
          surfaceCategory: "floor",
          colorHex: "#303030",
          colorName: "Dark gray",
          material: "carpet",
          roughness: 0.95,
          confidence: 0.8,
          evidenceKeyframeIds: [frameId],
        },
      ],
      objectSuggestions: [
        {
          name: "Work table",
          category: "furniture",
          description: "Rectangular work surface.",
          colorHex: "#a07040",
          material: "wood",
          confidence: 0.9,
          evidence: "Clearly visible in the first photo.",
          evidenceKeyframeIds: [missingFrameId],
          roomPlanCategory: "table",
        },
        {
          name: "Chair",
          category: "furniture",
          description: "One of two chairs.",
          colorHex: null,
          material: "plastic",
          confidence: 0.7,
          evidence: "Visible beside the table.",
          evidenceKeyframeIds: [frameId],
          roomPlanCategory: "chair",
        },
        {
          name: "Second table view",
          category: "furniture",
          description: "Duplicate table candidate.",
          colorHex: null,
          material: "wood",
          confidence: 0.5,
          evidence: "May be the same table.",
          evidenceKeyframeIds: [frameId],
          roomPlanCategory: "table",
        },
      ],
    },
  });

  assert.equal(analysis.surfaceAppearances.length, 1);
  assert.equal(analysis.surfaceAppearances[0].colorHex, "#F2F0EB");
  assert.deepEqual(analysis.surfaceAppearances[0].evidenceKeyframeIds, [frameId]);
  assert.equal(analysis.objectSuggestions[0].roomObjectId, scene.objects[0].id);
  assert.deepEqual(analysis.objectSuggestions[0].evidenceKeyframeIds, [frameId]);
  assert.equal(analysis.objectSuggestions[1].roomObjectId, null);
  assert.equal(analysis.objectSuggestions[2].roomObjectId, null);
  assert.ok(analysis.objectSuggestions.every(({ status }) => status === "pending"));
});
