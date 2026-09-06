import type * as THREE from "three";

export function roomPathTracerNeedsCoatFallback(userAgent: string) {
  return /AppleWebKit/.test(userAgent) && !/Chrome|Chromium|Edg\//.test(userAgent);
}

/** WebKit's WebGL clearcoat lobe produces black surfaces (upstream #711).
 * Keep the base material's color, grain, normals and specular roughness intact;
 * only omit the unsupported second reflection lobe in the traced shader.
 * https://github.com/gkjohnson/three-gpu-pathtracer/issues/711
 */
export function roomPathTracerShader(source: string, fallback: boolean) {
  if (!fallback || source.includes("ROOM_CLEARCOAT_FALLBACK")) return source;
  const anchor = "surf.clearcoat = clearcoat;";
  if (!source.includes(anchor)) throw new Error("room-clearcoat-shader-incompatible");
  return source.replace(anchor, "surf.clearcoat = 0.0; // ROOM_CLEARCOAT_FALLBACK");
}

export function configureRoomPathTracer(tracer: unknown) {
  const { _pathTracer } = tracer as { _pathTracer: { material: THREE.ShaderMaterial } };
  _pathTracer.material.fragmentShader = roomPathTracerShader(_pathTracer.material.fragmentShader,
    typeof navigator !== "undefined" && roomPathTracerNeedsCoatFallback(navigator.userAgent));
  _pathTracer.material.needsUpdate = true;
}

/** Three's asynchronous compiler still reads material programs after a frame.
 * Let it settle before releasing those programs or the WebGL context. */
export async function roomPathTracerSettled(tracer: unknown) {
  const internals = tracer as {
    _pathTracer?: { _compilePromise?: Promise<unknown> | null };
    _lowResPathTracer?: { _compilePromise?: Promise<unknown> | null };
  } | null;
  await Promise.allSettled([
    internals?._pathTracer?._compilePromise,
    internals?._lowResPathTracer?._compilePromise,
  ].filter(Boolean));
}
