import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { randomUUID } from "node:crypto";
import { rectangularRoomScene } from "../lib/room-scene-editor.ts";
import { createRoomLightingRig, createRoomLiveLighting, roomDisplayToneMapping } from "../lib/room-lighting-scene.ts";
import { rectAreaAxialIrradiance, roomKeyFloorIrradiance, roomKeyToFillRatio } from "../lib/room-lighting-rig.ts";

test("room emitters retain intensity, dimensions and relative position when a neighbour is added", () => {
 const room=rectangularRoomScene(5,4,2.8,randomUUID), rig=createRoomLightingRig(room);
 const world=new THREE.Scene(),root=new THREE.Group(); root.position.set(18,0,-10); root.rotateY(.65); root.add(rig.group); world.add(root); world.updateMatrixWorld(true);
 const before=rig.lights.map(light=>({power:light.intensity,width:light.width,height:light.height,position:light.getWorldPosition(new THREE.Vector3()).toArray()}));
 const neighbour=new THREE.Group();neighbour.position.set(80,4,20);neighbour.add(createRoomLightingRig(rectangularRoomScene(20,15,4,randomUUID)).group);world.add(neighbour);world.updateMatrixWorld(true);
 assert.deepEqual(rig.lights.map(light=>({power:light.intensity,width:light.width,height:light.height,position:light.getWorldPosition(new THREE.Vector3()).toArray()})),before);
 const center=new THREE.Vector3(0,1.4,0);
 for(const light of rig.lights){ const emission=new THREE.Vector3(0,0,-1).applyQuaternion(light.quaternion);assert.ok(emission.dot(center.clone().sub(light.position))>0); }
});
test("small and large rooms receive the same calibrated fill irradiance",()=>{
 for(const [w,d,h] of [[1,1,2],[6,4,2.8],[20,15,4]]){
  const fill=createRoomLightingRig(rectangularRoomScene(w,d,h,randomUUID)).lights[1];
  const irradiance=rectAreaAxialIrradiance({distance:h-.06,width:fill.width,height:fill.height,radiance:fill.intensity});
  assert.ok(Math.abs(irradiance-roomKeyFloorIrradiance()/roomKeyToFillRatio)<1e-9);
 }
});
test("live uses a fixed daylight approximation without area-light spill from neighbours",()=>{
 const rig=createRoomLiveLighting();assert.equal(rig.children.filter(x=>x.isLight).length,2);
 assert.ok(rig.children.every(x=>!x.isRectAreaLight));
 assert.equal(roomDisplayToneMapping,THREE.NeutralToneMapping);
});
