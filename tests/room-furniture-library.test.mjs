import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { zodTextFormat } from "openai/helpers/zod";
import {
  roomFurnitureVariants,
  roomFurnitureCatalog,
  automaticRoomFurnitureVariant,
  compatibleRoomFurnitureVariant,
  roomFurnitureReferenceVariants,
} from "../lib/room-furniture-catalog.ts";
import { instantiateRoomFurniture } from "../lib/room-furniture-assets.ts";
import {
  rectangularRoomScene,
  regenerateRoomPresentation,
  roomEditSchema,
} from "../lib/room-scene-editor.ts";
import { identitySpatialMatrix } from "../lib/room-scene-contract.ts";
import { roomAiGenerationSchema } from "../lib/room-ai-analysis-contract.ts";
import { buildRoomAiAnalysis } from "../lib/room-ai-analysis.ts";
import { roomFurnitureReferenceImages } from "../lib/room-furniture-reference-images.ts";
import {
  roomLightingAnalysisState,
  roomRenderCacheKey,
} from "../lib/room-render-cache.ts";

const packUrl = new URL(
  "../public/models/room-furniture/v2/furniture.glb",
  import.meta.url,
);

test("AI model thumbnails are bounded, local and explicitly separated from scan evidence", async () => {
  const content = await roomFurnitureReferenceImages([
    "chair",
    "storage",
    "table",
  ]);
  const images = content.filter((item) => item.type === "input_image");
  assert.equal(images.length, 12);
  assert.ok(
    images.every((item) => item.image_url.startsWith("data:image/png;base64,")),
  );
  const labels = content.filter((item) => item.type === "input_text");
  assert.equal(labels.length, images.length);
  assert.ok(
    labels.every(
      (item) =>
        item.text.includes("CATALOG REFERENCE ONLY") &&
        item.text.includes("not a scan photo"),
    ),
  );
  assert.deepEqual(await roomFurnitureReferenceImages(["unknown"]), []);
});
const bytes = await readFile(packUrl);
const jsonLength = bytes.readUInt32LE(12);
const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());

test("Blender exports every catalog model with embedded PBR resources and bounded payload", async () => {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.ok(bytes.length < 8 * 1024 * 1024);
  assert.equal(roomFurnitureVariants.length, 42);
  const exported = document.nodes.filter((node) => node.extras?.variant);
  assert.deepEqual(
    exported.map((node) => node.extras.variant).sort(),
    [...roomFurnitureVariants].sort(),
  );
  for (const variant of roomFurnitureVariants) {
    assert.ok(roomFurnitureCatalog[variant]);
    const image = await readFile(
      new URL(
        `../public/models/room-furniture/v2/${variant}.png`,
        import.meta.url,
      ),
    );
    assert.equal(image.subarray(1, 4).toString(), "PNG");
  }
  assert.ok(document.images.length >= 4);
  for (const image of document.images) {
    assert.equal(image.uri, undefined);
    assert.equal(typeof image.bufferView, "number");
  }
  assert.ok(document.materials.some((item) => item.extras?.inventoryTintable));
});

// Node has no image decoder. Remove texture bindings only; the exported mesh,
// scene hierarchy, transforms, attributes and material properties remain real.
const geometryDocument = structuredClone(document);
for (const material of geometryDocument.materials) {
  delete material.normalTexture;
  delete material.occlusionTexture;
  delete material.emissiveTexture;
  delete material.pbrMetallicRoughness?.baseColorTexture;
  delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
}
const json = Buffer.from(
  JSON.stringify(geometryDocument).padEnd(
    Math.ceil(JSON.stringify(geometryDocument).length / 4) * 4,
    " ",
  ),
);
const bin = bytes.subarray(20 + jsonLength);
const rebuilt = Buffer.alloc(20 + json.length + bin.length);
bytes.copy(rebuilt, 0, 0, 20);
rebuilt.writeUInt32LE(rebuilt.length, 8);
rebuilt.writeUInt32LE(json.length, 12);
json.copy(rebuilt, 20);
bin.copy(rebuilt, 20 + json.length);
const gltf = await new GLTFLoader().parseAsync(
  rebuilt.buffer.slice(
    rebuilt.byteOffset,
    rebuilt.byteOffset + rebuilt.byteLength,
  ),
  "",
);

test("all Blender models fit ARKit extents without sharing disposable geometry or materials", () => {
  for (const variant of roomFurnitureVariants) {
    const template = gltf.scene.children.find(
      (item) => item.userData.variant === variant,
    );
    assert.ok(template, variant);
    const dimensions = [0.83, 1.47, 0.59];
    const instance = instantiateRoomFurniture(template, dimensions);
    const bounds = new THREE.Box3().setFromObject(instance);
    const size = bounds.getSize(new THREE.Vector3()).toArray();
    size.forEach((value, axis) =>
      assert.ok(
        Math.abs(value - dimensions[axis]) < 1e-5,
        `${variant} axis ${axis}`,
      ),
    );
    assert.ok(bounds.getCenter(new THREE.Vector3()).length() < 1e-5, variant);
    let sourceMesh, copyMesh;
    template.traverse((node) => {
      if (node.isMesh) sourceMesh ??= node;
    });
    instance.traverse((node) => {
      if (node.isMesh) copyMesh ??= node;
    });
    assert.notEqual(sourceMesh.geometry, copyMesh.geometry);
    assert.notEqual(sourceMesh.material, copyMesh.material);
  }
});

test("open bookcase geometry preserves shelf voids", () => {
  const template = gltf.scene.children.find(
    (item) => item.userData.variant === "bookcase",
  );
  const bookcase = instantiateRoomFurniture(template, [1.2, 2.05, 0.34]);
  bookcase.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(0.25, 0.1, 1),
    new THREE.Vector3(0, 0, -1),
  );
  const hits = ray.intersectObject(bookcase, true);
  assert.ok(hits.length);
  assert.ok(
    hits[0].point.z < -0.1,
    "the ray passes through the opening and reaches the back panel",
  );
});

test("ARKit regeneration preserves geometry, manual finishes and georeference while refreshing presentation", () => {
  const scene = rectangularRoomScene(6, 4, 2.6, randomUUID);
  scene.objects = [
    {
      id: randomUUID(),
      category: "storage",
      dimensions: [1.8, 0.9, 0.4],
      transform: [...identitySpatialMatrix],
      confidence: "high",
      appearance: { variant: "bookcase", color: "#BBAA88" },
    },
  ];
  scene.mapAnchor = {
    latitude: 52,
    longitude: 13,
    headingDegrees: 30,
    capturedAt: "2026-09-06T00:00:00Z",
    source: "manual",
    localReferencePosition: [0, 0, 0],
  };
  const next = regenerateRoomPresentation(scene, "2026-09-06T00:01:00Z");
  assert.deepEqual(next.surfaces, scene.surfaces);
  assert.deepEqual(next.bounds, scene.bounds);
  assert.deepEqual(next.objects[0].transform, scene.objects[0].transform);
  assert.deepEqual(next.objects[0].appearance, scene.objects[0].appearance);
  assert.deepEqual(next.mapAnchor, scene.mapAnchor);
  assert.equal(next.objects[0].generatedModel.variant, "sideboard");
  assert.equal(next.presentation.generation, 1);
  assert.equal(regenerateRoomPresentation(next).presentation.generation, 2);
  assert.equal(scene.presentation, undefined);
  assert.ok(
    roomEditSchema.safeParse({ action: "regenerate", revision: 4 }).success,
  );
  assert.equal(
    roomEditSchema.safeParse({ action: "regenerate", revision: 0 }).success,
    false,
  );
});

test("automatic geometry hints avoid unsupported furniture subtypes and AI model schema is strict", () => {
  assert.equal(
    automaticRoomFurnitureVariant("storage", [1, 2, 0.4]),
    "wardrobe",
  );
  assert.equal(
    automaticRoomFurnitureVariant("bed", [0.9, 0.7, 2]),
    "single-bed",
  );
  assert.equal(
    automaticRoomFurnitureVariant("table", [1, 0.4, 0.6]),
    "coffee-table",
  );
  assert.equal(automaticRoomFurnitureVariant("unknown", [1, 1, 1]), null);
  assert.equal(
    compatibleRoomFurnitureVariant("bookcase", "storage"),
    "bookcase",
  );
  assert.equal(compatibleRoomFurnitureVariant("bed", "storage"), null);
  const schema = zodTextFormat(roomAiGenerationSchema, "room_analysis").schema;
  const item = schema.properties.objectSuggestions.items;
  assert.ok(item.required.includes("modelVariant"));
  assert.equal(item.additionalProperties, false);
  const references = roomFurnitureReferenceVariants([
    "storage",
    "table",
    "storage",
    "bed",
  ]);
  assert.ok(references.length <= 12);
  assert.equal(new Set(references).size, references.length);
  assert.ok(
    references.some(
      (variant) => roomFurnitureCatalog[variant].category === "bed",
    ),
  );
  assert.ok(
    references.every((variant) =>
      ["storage", "table", "bed"].includes(
        roomFurnitureCatalog[variant].category,
      ),
    ),
  );
  assert.deepEqual(roomFurnitureReferenceVariants(["unknown"]), []);
});

test("AI selects catalog models only for clear supported matching categories and changes invalidate lighting", async () => {
  const scene = rectangularRoomScene(4, 4, 2.6, randomUUID),
    frame = randomUUID(),
    objectId = randomUUID();
  scene.objects = [
    {
      id: objectId,
      category: "storage",
      dimensions: [1, 2, 0.4],
      transform: [...identitySpatialMatrix],
      confidence: "high",
    },
  ];
  const suggestion = {
    name: "Bookcase",
    category: "storage",
    description: "",
    colorHex: null,
    material: "wood",
    confidence: 0.9,
    evidence: "Open shelves are visible",
    evidenceKeyframeIds: [frame],
    imageEvidence: [
      {
        keyframeId: frame,
        bounds: [100, 100, 800, 900],
        confidence: 0.9,
        visibility: "clear",
      },
    ],
    roomPlanCategory: "storage",
    roomPlanObjectId: objectId,
    modelVariant: "bookcase",
    primitiveModel: null,
  };
  const analyze = (patch) =>
    buildRoomAiAnalysis({
      scene,
      keyframeIds: [frame],
      model: "test",
      createId: randomUUID,
      detection: {
        summary: "Shelves",
        surfaceAppearances: [],
        objectSuggestions: [{ ...suggestion, ...patch }],
      },
    });
  assert.equal(analyze({}).objectSuggestions[0].modelVariant, "bookcase");
  assert.equal(
    analyze({ modelVariant: "bed" }).objectSuggestions[0].modelVariant,
    null,
  );
  assert.equal(
    analyze({ confidence: 0.5 }).objectSuggestions[0].modelVariant,
    null,
  );
  assert.equal(
    analyze({
      imageEvidence: [
        { ...suggestion.imageEvidence[0], visibility: "occluded" },
      ],
    }).objectSuggestions[0].modelVariant,
    null,
  );
  const analysis = analyze({});
  analysis.objectSuggestions[0].status = "accepted";
  const before = await roomRenderCacheKey(roomLightingAnalysisState(analysis));
  analysis.objectSuggestions[0].modelVariant = "shelving";
  assert.notEqual(
    before,
    await roomRenderCacheKey(roomLightingAnalysisState(analysis)),
  );
});

test("every catalog model is selectable by the AI contract in its matching category", () => {
  const schema = zodTextFormat(roomAiGenerationSchema, "room_analysis").schema;
  const variants = schema.properties.objectSuggestions.items.properties.modelVariant;
  const encoded = JSON.stringify(variants);
  for (const variant of roomFurnitureVariants) {
    assert.ok(encoded.includes(`\"${variant}\"`), variant);
    assert.equal(compatibleRoomFurnitureVariant(variant, roomFurnitureCatalog[variant].category), variant);
    assert.equal(compatibleRoomFurnitureVariant(variant, "unknown"), null);
  }
});

test("changing a furniture color preserves relief and the original metal / ceramic parts", () => {
  for (const variant of roomFurnitureVariants) {
    const template = gltf.scene.children.find(item => item.userData.variant === variant);
    const tinted = instantiateRoomFurniture(template, [1,1,1], "#4499cc");
    const originals = [], copies = [];
    template.traverse(node => { if (node.isMesh) originals.push(node); });
    tinted.traverse(node => { if (node.isMesh) copies.push(node); });
    copies.forEach((node, index) => {
      const material = node.material, original = originals[index].material;
      assert.equal(material.roughness, original.roughness);
      assert.equal(material.metalness, original.metalness);
      if (original.userData.inventoryTintable) assert.equal(material.color.getHexString(), "4499cc");
      else assert.equal(material.color.getHexString(), original.color.getHexString());
    });
  }
  for (const material of document.materials.filter(item => ["wood", "fabric"].includes(item.extras?.inventoryFinish))) {
    assert.ok(material.normalTexture, material.name);
    assert.ok(material.pbrMetallicRoughness.metallicRoughnessTexture, material.name);
    assert.ok(material.pbrMetallicRoughness.baseColorTexture, material.name);
  }
});
