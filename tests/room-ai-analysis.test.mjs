import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { createAiPrimitiveObjectModel } from "../components/room-object-models.ts";
import { buildRoomAiAnalysis } from "../lib/room-ai-analysis.ts";
import {
  roomAiAnalysisSchema,
  roomPrimitiveModelSchema,
} from "../lib/room-ai-analysis-contract.ts";

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
          primitiveModel: {
            label: "Wooden work table",
            parts: [
              {
                primitive: "box",
                position: [0, 0.42, 0],
                size: [0.95, 0.12, 0.9],
                rotationDegrees: [0, 0, 0],
                colorHex: "#A07040",
                material: "wood",
              },
              ...[-0.38, 0.38].flatMap((x) => [-0.34, 0.34].map((z) => ({
                primitive: "box",
                position: [x, -0.08, z],
                size: [0.09, 0.88, 0.09],
                rotationDegrees: [0, 0, 0],
                colorHex: "#704522",
                material: "wood",
              }))),
            ],
          },
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
          primitiveModel: null,
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
          primitiveModel: null,
        },
      ],
    },
  });

  assert.equal(analysis.surfaceAppearances.length, 1);
  assert.equal(analysis.surfaceAppearances[0].colorHex, "#F2F0EB");
  assert.equal(analysis.surfaceAppearances[0].status, "pending");
  assert.deepEqual(analysis.surfaceAppearances[0].evidenceKeyframeIds, [frameId]);
  assert.equal(analysis.objectSuggestions[0].roomObjectId, scene.objects[0].id);
  assert.equal(analysis.objectSuggestions[0].primitiveModel?.parts.length, 5);
  assert.deepEqual(analysis.objectSuggestions[0].evidenceKeyframeIds, [frameId]);
  assert.equal(analysis.objectSuggestions[1].roomObjectId, null);
  assert.equal(analysis.objectSuggestions[2].roomObjectId, null);
  assert.ok(analysis.objectSuggestions.every(({ status }) => status === "pending"));
});

test("rejects unsafe or oversized AI primitive model recipes", () => {
  const validPart = {
    primitive: "box",
    position: [0, 0, 0],
    size: [0.5, 0.5, 0.5],
    rotationDegrees: [0, 0, 0],
    colorHex: "#AABBCC",
    material: "plastic",
  };

  assert.equal(roomPrimitiveModelSchema.safeParse({
    label: "Small box",
    parts: [validPart],
  }).success, true);
  assert.equal(roomPrimitiveModelSchema.safeParse({
    label: "Executable model",
    parts: [{ ...validPart, primitive: "javascript", code: "alert(1)" }],
  }).success, false);
  assert.equal(roomPrimitiveModelSchema.safeParse({
    label: "Too many parts",
    parts: Array.from({ length: 33 }, () => validPart),
  }).success, false);
});

test("renders a confirmed primitive recipe inside its RoomPlan bounds", () => {
  const model = createAiPrimitiveObjectModel({
    dimensions: [1.2, 0.8, 0.7],
    model: roomPrimitiveModelSchema.parse({
      label: "Side table",
      parts: [
        {
          primitive: "box",
          position: [0, 0.42, 0],
          size: [1, 0.12, 1],
          rotationDegrees: [0, 0, 0],
          colorHex: "#8A603B",
          material: "wood",
        },
        {
          primitive: "cylinder",
          position: [0, -0.08, 0],
          size: [0.18, 0.88, 0.18],
          rotationDegrees: [0, 0, 0],
          colorHex: "#555555",
          material: "metal",
        },
        {
          primitive: "sphere",
          position: [0, -0.48, 0],
          size: [0.5, 0.08, 0.5],
          rotationDegrees: [0, 0, 0],
          colorHex: "#555555",
          material: "metal",
        },
      ],
    }),
  });
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());

  assert.equal(model.userData.aiGenerated, true);
  assert.equal(model.children[0].children.length, 3);
  assert.ok(size.x <= 1.2 + 1e-6);
  assert.ok(size.y <= 0.8 + 1e-6);
  assert.ok(size.z <= 0.7 + 1e-6);
});

test("keeps stored room analyses from before primitive models readable", () => {
  const legacy = roomAiAnalysisSchema.parse({
    schemaVersion: 1,
    analyzedAt: "2026-08-21T10:00:00.000Z",
    model: "vision-test",
    summary: "Legacy analysis",
    analyzedKeyframeIds: [frameId],
    surfaceAppearances: [],
    objectSuggestions: [{
      id: "77777777-7777-4777-8777-777777777777",
      name: "Table",
      category: "furniture",
      description: "A table",
      colorHex: "#A07040",
      material: "wood",
      confidence: 0.8,
      evidence: "Visible in the photo.",
      evidenceKeyframeIds: [frameId],
      roomObjectId: scene.objects[0].id,
      status: "pending",
    }],
  });

  assert.equal(legacy.objectSuggestions[0].primitiveModel, null);
});
