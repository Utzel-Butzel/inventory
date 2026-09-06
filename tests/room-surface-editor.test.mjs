import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { rectangularRoomScene, roomEditSchema } from "../lib/room-scene-editor.ts";
import { roomSceneSchema } from "../lib/room-scene-contract.ts";
import { applyRoomSurfaceEdit, resizeRoomSurface, roomSurfaceParentWall } from "../lib/room-surface-editor.ts";
import { multiplySpatialMatrices } from "../lib/room-floor-layout.ts";
import { roomRenderCacheKey } from "../lib/room-render-cache.ts";

const fixture = () => {
  const scene = rectangularRoomScene(6,4,2.8,randomUUID);
  const wall = scene.surfaces[1];
  const transform = [...wall.transform]; transform[12] = .8; transform[13] = 1.65;
  scene.surfaces.push({id:randomUUID(),category:"window",dimensions:[1.2,1.1,.06],transform,confidence:"high"});
  return scene;
};
test("manual surface finishes survive storage and regeneration contracts", async () => {
  const scene = fixture(), wall=scene.surfaces[1];
  const edit = roomEditSchema.parse({action:"surface",revision:3,surface:{...wall,appearance:{colorHex:"#445588",material:"paint",roughness:.91}}});
  const next=applyRoomSurfaceEdit(scene,edit.surface);
  assert.deepEqual(roomSceneSchema.parse(JSON.parse(JSON.stringify(next))).surfaces[1].appearance,edit.surface.appearance);
  assert.equal(scene.surfaces[1].appearance,undefined);
  assert.deepEqual(next.bounds,scene.bounds);
  assert.notEqual(await roomRenderCacheKey(scene),await roomRenderCacheKey(next));
  assert.equal(roomEditSchema.safeParse({...edit,surface:{...edit.surface,appearance:{...edit.surface.appearance,roughness:2}}}).success,false);
});
test("moving and rotating a wall carries only its associated aperture and updates bounds", () => {
  const scene=fixture(), wall=scene.surfaces[1], window=scene.surfaces.at(-1);
  assert.equal(roomSurfaceParentWall(scene,window),wall.id);
  const delta=[0,0,-1,0,0,1,0,0,1,0,0,0,8,0,0,1];
  const next=applyRoomSurfaceEdit(scene,{...wall,transform:multiplySpatialMatrices(delta,wall.transform)});
  assert.deepEqual(next.surfaces.at(-1).transform,multiplySpatialMatrices(delta,window.transform));
  assert.deepEqual(next.surfaces[2],scene.surfaces[2]);
  assert.ok(next.bounds.max[0]>scene.bounds.max[0]);
  assert.deepEqual(next.worldFromModel,scene.worldFromModel);
});
test("editing a window never moves its wall and resizing preserves a measured polygon", () => {
  const scene=fixture(), window=scene.surfaces.at(-1);
  window.polygonCorners=[[-.6,-.55,0],[.6,-.55,0],[.6,.55,0],[-.6,.55,0]];
  const resized=resizeRoomSurface(window,[2.4,2.2,.06]);
  assert.deepEqual(resized.polygonCorners,[[-1.2,-1.1,0],[1.2,-1.1,0],[1.2,1.1,0],[-1.2,1.1,0]]);
  const next=applyRoomSurfaceEdit(scene,resized);
  assert.deepEqual(next.surfaces[1],scene.surfaces[1]);
  assert.throws(()=>applyRoomSurfaceEdit(scene,{...window,id:randomUUID()}),/surface-not-found/);
  assert.throws(()=>applyRoomSurfaceEdit(scene,{...window,category:"wall"}),/surface-category-changed/);
  assert.throws(()=>applyRoomSurfaceEdit(scene,{...window,dimensions:[0,0,0]}),/surface-too-small/);
});
