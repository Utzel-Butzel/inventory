import assert from "node:assert/strict";
import test from "node:test";
import { labelImageCropBounds, waitForLabelImageCrops } from "../lib/label-image-crop.ts";
import { labelElementsSchema } from "../lib/label-setup-contract.ts";
function fixture(background = 255, alpha = 255) {
  const image = { width: 100, height: 100, data: new Uint8ClampedArray(40000) };
  for (let i = 0; i < 10000; i++) image.data.set([background, background, background, alpha], i * 4);
  return image;
}
function rect(image, x, y, w, h, color = 0, alpha = 255) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) image.data.set([color, color, color, alpha], (yy * image.width + xx) * 4);
}
test("white margins crop tightly, ignore dust and preserve internal white holes", () => {
  const image = fixture(); rect(image, 20, 30, 60, 40); rect(image, 30, 35, 40, 30, 255); rect(image, 2, 2, 1, 1);
  assert.deepEqual(labelImageCropBounds(image, 20, 0), {x:20,y:30,width:60,height:40});
});
test("tolerance removes near-white backgrounds and transparency composites against white", () => {
  const gray = fixture(240); rect(gray, 20, 30, 60, 40);
  assert.equal(labelImageCropBounds(gray, 10, 0).width, 100);
  assert.equal(labelImageCropBounds(gray, 20, 0).width, 60);
  const transparent = fixture(0, 0); rect(transparent, 20, 30, 60, 40);
  assert.deepEqual(labelImageCropBounds(transparent, 20, 0), {x:20,y:30,width:60,height:40});
});
test("padding zooms out or in, clamps edges and preserves narrow objects", () => {
  const image = fixture(); rect(image, 20, 30, 60, 40);
  assert.deepEqual(labelImageCropBounds(image, 20, 10), {x:14,y:26,width:72,height:48});
  assert.deepEqual(labelImageCropBounds(image, 20, -10), {x:26,y:34,width:48,height:32});
  rect(image, 0, 0, 100, 100);
  assert.deepEqual(labelImageCropBounds(image, 20, 20), {x:0,y:0,width:100,height:100});
  const narrow = fixture(); rect(narrow, 49, 10, 2, 80);
  assert.ok(labelImageCropBounds(narrow, 20, -10).width >= 1);
});
test("blank images stay intact and separate product parts survive", () => {
  assert.deepEqual(labelImageCropBounds(fixture()), {x:0,y:0,width:100,height:100});
  const image = fixture(); rect(image, 10, 10, 20, 20); rect(image, 80, 80, 5, 5);
  assert.deepEqual(labelImageCropBounds(image, 20, 0), {x:10,y:10,width:75,height:75});
});
test("crop settings round-trip and invalid settings are rejected; legacy images remain valid", () => {
  const image = {type:"image",x:0,y:0,width:100,height:100,visible:true};
  assert.deepEqual(labelElementsSchema.parse([image]), [image]);
  const cropped = {...image,cropWhiteMargins:true,cropTolerance:25,cropPadding:-5};
  assert.deepEqual(labelElementsSchema.parse([cropped]), [cropped]);
  for (const patch of [{cropTolerance:81},{cropTolerance:-1},{cropPadding:21},{cropPadding:-11},{cropWhiteMargins:"true"}]) {
    assert.equal(labelElementsSchema.safeParse([{...image,...patch}]).success,false);
  }
});
test("print readiness waits for processing and rejects crop failures", async () => {
  let pending = true;
  const node = {querySelector: selector => selector.includes('pending') && pending ? {} : null};
  setTimeout(() => {pending = false;}, 40);
  await waitForLabelImageCrops(node);
  assert.equal(pending,false);
  await assert.rejects(waitForLabelImageCrops({querySelector: selector => selector.includes('error') ? {getAttribute: () => 'Crop failed'} : null}), /Crop failed/);
});
