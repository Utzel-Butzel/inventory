import assert from "node:assert/strict";
import test from "node:test";
import { zodTextFormat } from "openai/helpers/zod";
import * as THREE from "three";

import {
  createAiPrimitiveObjectModel,
  isRecognizableAiPrimitiveModel,
} from "../components/room-object-models.ts";
import { applyDetectedRoomFinish } from "../components/room-scene-materials.ts";
import { buildRoomAiAnalysis } from "../lib/room-ai-analysis.ts";
import { selectRoomAnalysisPhotoSources } from "../lib/room-analysis-photo-sources.ts";
import { roomVisionModelCapabilities } from "../lib/openai-model-capabilities.ts";
import { roomObjectProjectionMatchesEvidence } from "../lib/room-photo-grounding.ts";
import { resolveRoomWindowPaneGrid } from "../lib/room-window-details.ts";
import {
  maximumRoomAnalysisKeyframes,
  maximumRoomObjectSuggestions,
  detectedRoomPrimitiveModelSchema,
  roomAiAnalysisSchema,
  roomAiDetectionSchema,
  roomPhotoDetectionSchema,
  roomPrimitiveModelSchema,
  roomWindowDetailsSchema,
} from "../lib/room-ai-analysis-contract.ts";

const matrix = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];
const frameId = "11111111-1111-4111-8111-111111111111";
const missingFrameId = "22222222-2222-4222-8222-222222222222";

test("uses an uncalibrated guide image when a scan has no keyframes", () => {
  const sources = selectRoomAnalysisPhotoSources({
    keyframes: [],
    guideImage: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      storageKey: "room/guide.jpg",
      storageUrl: "file:///room/guide.jpg",
    },
  });

  assert.deepEqual(sources, [{
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    quality: 1,
    orientation: "up",
    storageKey: "room/guide.jpg",
    storageUrl: "file:///room/guide.jpg",
    cameraTransform: null,
    intrinsics: null,
    nativeWidth: null,
    nativeHeight: null,
  }]);
});

test("retains pose, intrinsics, and native dimensions for calibrated photos", () => {
  const intrinsics = [900, 0, 0, 0, 900, 0, 800, 600, 1];
  const [source] = selectRoomAnalysisPhotoSources({
    guideImage: null,
    keyframes: [{
      id: frameId,
      quality: 0.9,
      orientation: "right",
      storageKey: "room/frame.jpg",
      storageUrl: "file:///room/frame.jpg",
      cameraTransform: matrix,
      intrinsics,
      imageWidth: 1_600,
      imageHeight: 1_200,
    }],
  });

  assert.deepEqual(source, {
    id: frameId,
    quality: 0.9,
    orientation: "right",
    storageKey: "room/frame.jpg",
    storageUrl: "file:///room/frame.jpg",
    cameraTransform: matrix,
    intrinsics,
    nativeWidth: 1_600,
    nativeHeight: 1_200,
  });
});

test("uses only vision parameters supported by the configured model", () => {
  assert.deepEqual(roomVisionModelCapabilities("gpt-4.1-mini"), {
    imageDetail: "high",
    reasoning: null,
  });
  assert.deepEqual(roomVisionModelCapabilities("gpt-5.6-terra"), {
    imageDetail: "original",
    reasoning: { effort: "medium" },
  });
});

test("rejects a tiny photo object mapped onto a much larger RoomPlan anchor", () => {
  const projection = {
    imagePoint: [500, 500],
    imageBounds: [100, 100, 900, 900],
  };
  assert.equal(roomObjectProjectionMatchesEvidence({
    ...projection,
    evidenceBounds: [460, 460, 530, 530],
    visibility: "clear",
  }), false);
  assert.equal(roomObjectProjectionMatchesEvidence({
    ...projection,
    evidenceBounds: [140, 160, 860, 880],
    visibility: "clear",
  }), true);
});

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

test("grounds explicit duplicate RoomPlan categories and keeps real evidence only", () => {
  let id = 7;
  const analysis = buildRoomAiAnalysis({
    scene,
    keyframeIds: [frameId],
    calibratedKeyframeIds: [frameId],
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
          windowDetails: null,
        },
        {
          surfaceCategory: "floor",
          colorHex: "#303030",
          colorName: "Dark gray",
          material: "carpet",
          roughness: 0.95,
          confidence: 0.8,
          evidenceKeyframeIds: [frameId],
          windowDetails: null,
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
          evidenceKeyframeIds: [missingFrameId, frameId],
          imageEvidence: [{
            keyframeId: frameId,
            bounds: [80, 240, 720, 840],
            visibility: "clear",
            confidence: 0.94,
          }],
          roomPlanCategory: "table",
          roomPlanObjectId: scene.objects[0].id,
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
              {
                primitive: "box",
                position: [0, -0.12, 0],
                size: [0.72, 0.06, 0.06],
                rotationDegrees: [0, 0, 0],
                colorHex: "#704522",
                material: "wood",
              },
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
          imageEvidence: [{
            keyframeId: frameId,
            bounds: [950, 920, 700, 300],
            visibility: "partial",
            confidence: 0.72,
          }],
          roomPlanCategory: "chair",
          roomPlanObjectId: scene.objects[1].id,
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
          imageEvidence: [{
            keyframeId: frameId,
            bounds: [80, 240, 720, 840],
            visibility: "clear",
            confidence: 0.55,
          }],
          roomPlanCategory: "table",
          roomPlanObjectId: scene.objects[0].id,
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
  assert.equal(analysis.objectSuggestions[0].primitiveModel?.parts.length, 6);
  assert.deepEqual(analysis.objectSuggestions[0].evidenceKeyframeIds, [frameId]);
  assert.equal(analysis.objectSuggestions[1].roomObjectId, scene.objects[1].id);
  assert.deepEqual(
    analysis.objectSuggestions[1].imageEvidence[0].bounds,
    [700, 300, 950, 920],
  );
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
  assert.equal(roomPrimitiveModelSchema.safeParse({
    label: "Short vector",
    parts: [{ ...validPart, position: [0, 0] }],
  }).success, false);
  assert.equal(roomPrimitiveModelSchema.safeParse({
    label: "Long vector",
    parts: [{ ...validPart, size: [0.5, 0.5, 0.5, 0.5] }],
  }).success, false);
  assert.equal(detectedRoomPrimitiveModelSchema.safeParse({
    label: "Under-specified chair",
    parts: Array.from({ length: 5 }, () => validPart),
  }).success, false);
  assert.equal(detectedRoomPrimitiveModelSchema.safeParse({
    label: "Structured chair",
    parts: Array.from({ length: 6 }, () => validPart),
  }).success, true);
});

test("builds an OpenAI strict response format for room analysis", () => {
  assert.equal(maximumRoomAnalysisKeyframes, 24);
  assert.equal(maximumRoomObjectSuggestions, 48);
  assert.doesNotThrow(() =>
    zodTextFormat(roomAiDetectionSchema, "room_ai_analysis"),
  );
  assert.doesNotThrow(() =>
    zodTextFormat(roomPhotoDetectionSchema, "room_photo_detection"),
  );
});

test("drops suggestions whose cited evidence is not an analyzed photo", () => {
  const analysis = buildRoomAiAnalysis({
    scene,
    keyframeIds: [frameId],
    model: "vision-test",
    analyzedAt: "2026-08-21T10:00:00.000Z",
    createId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    detection: {
      summary: "One unsupported candidate.",
      surfaceAppearances: [],
      objectSuggestions: [{
        name: "Unsupported chair",
        category: "furniture",
        description: "Only linked to an unknown photo.",
        colorHex: null,
        material: "plastic",
        confidence: 0.4,
        evidence: "Not present in an analyzed photo.",
        evidenceKeyframeIds: [missingFrameId],
        imageEvidence: [{
          keyframeId: missingFrameId,
          bounds: [100, 100, 500, 900],
          visibility: "partial",
          confidence: 0.4,
        }],
        roomPlanCategory: "chair",
        roomPlanObjectId: scene.objects[1].id,
        primitiveModel: null,
      }],
    },
  });

  assert.deepEqual(analysis.objectSuggestions, []);
});

test("keeps uncalibrated object placement explicitly estimated and movable", () => {
  const analysis = buildRoomAiAnalysis({
    scene,
    keyframeIds: [frameId],
    calibratedKeyframeIds: [],
    model: "vision-test",
    analyzedAt: "2026-08-21T10:00:00.000Z",
    createId: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    detection: {
      summary: "A chair is visible in an uncalibrated guide photo.",
      surfaceAppearances: [],
      objectSuggestions: [{
        name: "Mesh office chair",
        category: "furniture",
        description: "Black chair beside the desk.",
        colorHex: "#202124",
        material: "fabric",
        confidence: 0.94,
        evidence: "Visible in the guide photo.",
        evidenceKeyframeIds: [frameId],
        imageEvidence: [{
          keyframeId: frameId,
          bounds: [100, 180, 520, 940],
          visibility: "clear",
          confidence: 0.94,
        }],
        roomPlanCategory: "chair",
        roomPlanObjectId: scene.objects[1].id,
        primitiveModel: {
          label: "Office chair",
          parts: Array.from({ length: 6 }, () => ({
            primitive: "box",
            position: [0, 0, 0],
            size: [0.2, 0.2, 0.2],
            rotationDegrees: [0, 0, 0],
            colorHex: "#202124",
            material: "fabric",
          })),
        },
      }],
    },
  });

  assert.equal(analysis.objectSuggestions.length, 1);
  assert.equal(analysis.objectSuggestions[0].roomObjectId, null);
  assert.equal(analysis.objectSuggestions[0].primitiveModel?.parts.length, 6);
  assert.deepEqual(
    analysis.objectSuggestions[0].estimatedPlacement?.dimensions,
    [0.55, 1, 0.55],
  );
  assert.ok(analysis.objectSuggestions[0].estimatedPlacement?.position.every(
    (value, axis) =>
      value >= scene.bounds.min[axis] && value <= scene.bounds.max[axis],
  ));
});

test("does not override an explicit null RoomPlan match by category uniqueness", () => {
  const analysis = buildRoomAiAnalysis({
    scene,
    keyframeIds: [frameId],
    calibratedKeyframeIds: [frameId],
    model: "vision-test",
    analyzedAt: "2026-08-21T10:00:00.000Z",
    createId: () => "abababab-abab-4bab-8bab-abababababab",
    detection: {
      summary: "A newly visible side table is not an existing RoomPlan anchor.",
      surfaceAppearances: [],
      objectSuggestions: [{
        name: "Small side table",
        category: "furniture",
        description: "A partial table at the edge of the photo.",
        colorHex: "#A07040",
        material: "wood",
        confidence: 0.75,
        evidence: "Only part of the table is visible.",
        evidenceKeyframeIds: [frameId],
        imageEvidence: [{
          keyframeId: frameId,
          bounds: [0, 300, 180, 850],
          visibility: "partial",
          confidence: 0.75,
        }],
        roomPlanCategory: "table",
        roomPlanObjectId: null,
        primitiveModel: null,
      }],
    },
  });

  assert.equal(analysis.objectSuggestions[0].roomObjectId, null);
  assert.ok(analysis.objectSuggestions[0].estimatedPlacement);
});

test("keeps detected window type and muntin grid pending until confirmation", () => {
  const windowDetails = roomWindowDetailsSchema.parse({
    type: "tilt-turn",
    hasMuntins: true,
    paneColumns: 3,
    paneRows: 2,
    confidence: 0.88,
  });
  const analysis = buildRoomAiAnalysis({
    scene: {
      ...scene,
      surfaces: [
        ...scene.surfaces,
        {
          id: "88888888-8888-4888-8888-888888888888",
          category: "window",
          dimensions: [1.8, 1.2, 0.08],
          transform: matrix,
          confidence: "high",
        },
      ],
    },
    keyframeIds: [frameId],
    model: "vision-test",
    analyzedAt: "2026-08-21T10:00:00.000Z",
    createId: () => "99999999-9999-4999-8999-999999999999",
    detection: {
      summary: "A white tilt-and-turn window with muntins.",
      surfaceAppearances: [{
        surfaceCategory: "window",
        colorHex: "#F4F2EC",
        colorName: "Warm white",
        material: "paint",
        roughness: 0.72,
        confidence: 0.9,
        evidenceKeyframeIds: [frameId],
        windowDetails,
      }],
      objectSuggestions: [],
    },
  });

  assert.equal(analysis.surfaceAppearances[0].status, "pending");
  assert.deepEqual(analysis.surfaceAppearances[0].windowDetails, windowDetails);
  assert.deepEqual(resolveRoomWindowPaneGrid(windowDetails, [1.7, 1.1]), {
    columns: 3,
    rows: 2,
  });
  assert.deepEqual(resolveRoomWindowPaneGrid({
    ...windowDetails,
    hasMuntins: false,
    paneColumns: null,
    paneRows: null,
  }, [1.7, 1.1]), { columns: 1, rows: 1 });
});

test("renders a confirmed primitive recipe inside its RoomPlan bounds", () => {
  const model = createAiPrimitiveObjectModel({
    category: "table",
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
  assert.ok(Math.abs(bounds.min.y + 0.4) <= 1e-6);
  assert.equal(model.children[0].scale.x, model.children[0].scale.y);
  assert.equal(model.children[0].scale.y, model.children[0].scale.z);
});

test("rejects visually incomplete primitive recipes before replacing RoomPlan models", () => {
  const singleBox = roomPrimitiveModelSchema.parse({
    label: "Orange chair",
    parts: [{
      primitive: "box",
      position: [0, 0, 0],
      size: [0.8, 0.9, 0.8],
      rotationDegrees: [0, 0, 0],
      colorHex: "#D96835",
      material: "plastic",
    }],
  });
  assert.equal(isRecognizableAiPrimitiveModel({
    category: "chair",
    model: singleBox,
  }), false);
});

test("keeps stored room analyses from before primitive models readable", () => {
  const legacy = roomAiAnalysisSchema.parse({
    schemaVersion: 1,
    analyzedAt: "2026-08-21T10:00:00.000Z",
    model: "vision-test",
    summary: "Legacy analysis",
    analyzedKeyframeIds: [frameId],
    surfaceAppearances: [{
      id: "12121212-1212-4212-8212-121212121212",
      surfaceCategory: "wall",
      colorHex: "#F0F0F0",
      colorName: "White",
      material: "paint",
      roughness: 0.8,
      confidence: 0.7,
      evidenceKeyframeIds: [],
      windowDetails: null,
      status: "pending",
    }],
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
  assert.equal(legacy.objectSuggestions[0].estimatedPlacement, null);
  assert.deepEqual(legacy.objectSuggestions[0].imageEvidence, []);
  assert.deepEqual(legacy.surfaceAppearances[0].evidenceKeyframeIds, []);
});

test("keeps an accepted light-gray door finish free of the brown base texture", () => {
  const brownBaseMap = new THREE.Texture();
  const originalNormalMap = new THREE.Texture();
  const originalRoughnessMap = new THREE.Texture();
  const paintNormalMap = new THREE.Texture();
  const paintRoughnessMap = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: brownBaseMap,
    normalMap: originalNormalMap,
    roughnessMap: originalRoughnessMap,
  });

  applyDetectedRoomFinish(
    material,
    { colorHex: "#D3D3D3", material: "paint", roughness: 0.84 },
    {
      paint: {
        normalMap: paintNormalMap,
        roughnessMap: paintRoughnessMap,
        normalScale: 0.42,
      },
      wood: {
        normalMap: new THREE.Texture(),
        roughnessMap: new THREE.Texture(),
        normalScale: 0.58,
      },
      fabric: {
        normalMap: new THREE.Texture(),
        roughnessMap: new THREE.Texture(),
        normalScale: 0.72,
      },
    },
  );

  assert.equal(material.map, null);
  assert.equal(material.normalMap, paintNormalMap);
  assert.equal(material.roughnessMap, paintRoughnessMap);
  assert.equal(material.color.getHexString().toUpperCase(), "D3D3D3");
  assert.equal(material.roughness, 0.84);
});
