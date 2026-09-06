import assert from "node:assert/strict";
import test from "node:test";
import { PhysicalPathTracingMaterial } from "three-gpu-pathtracer";
import { roomPathTracerNeedsCoatFallback, roomPathTracerShader, roomPathTracerSettled } from "../lib/room-pathtracer-compatibility.ts";

test("WebKit fallback preserves the production shader except the broken coat lobe", () => {
  const material = new PhysicalPathTracingMaterial();
  const source = material.fragmentShader;
  assert.equal(roomPathTracerShader(source, false), source);
  const patched = roomPathTracerShader(source, true);
  assert.equal(patched.replace("surf.clearcoat = 0.0; // ROOM_CLEARCOAT_FALLBACK", "surf.clearcoat = clearcoat;"), source);
  assert.equal(roomPathTracerShader(patched, true), patched);
  assert.equal(material.fragmentShader, source);
  assert.throws(() => roomPathTracerShader("incompatible future shader", true), /incompatible/);
  material.dispose();
});

test("the clearcoat workaround targets WebKit, leaving Chromium and Firefox unchanged", () => {
  assert.equal(roomPathTracerNeedsCoatFallback("Mozilla/5.0 AppleWebKit/605.1.15 Version/18.3 Safari/605.1.15"), true);
  assert.equal(roomPathTracerNeedsCoatFallback("Mozilla/5.0 AppleWebKit/537.36 Chrome/136.0 Safari/537.36"), false);
  assert.equal(roomPathTracerNeedsCoatFallback("Mozilla/5.0 Gecko/20100101 Firefox/135.0"), false);
});

test("GPU cleanup waits for both shader compilers, including failed compilations", async () => {
  let completeMain, completePreview, settled = false;
  const main = new Promise(resolve => { completeMain = resolve; });
  const preview = new Promise((_, reject) => { completePreview = reject; });
  const cleanup = roomPathTracerSettled({ _pathTracer: { _compilePromise: main }, _lowResPathTracer: { _compilePromise: preview } }).then(() => { settled = true; });
  completeMain();
  await Promise.resolve();
  assert.equal(settled, false);
  completePreview(new Error("cancelled"));
  await cleanup;
  assert.equal(settled, true);
  await roomPathTracerSettled(null);
});
