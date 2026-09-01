import * as THREE from "three";

/** Texture tiles per metre on painted wall, reveal and opening surfaces. */
export const wallTextureTilesPerMetre = 1.2;

/** Texture tiles per metre on the floor. */
export const floorTextureTilesPerMetre = 1.1;

/**
 * Rewrites a surface's texture UVs as a metric box projection.
 *
 * The architecture is built two different ways: a wall whose window sits fully
 * inside it becomes one ExtrudeGeometry, and any other wall becomes a set of
 * PlaneGeometry pieces. Those two disagree about what a UV means — extrusion
 * emits local metres while planes emit 0..1 across whatever piece they happen
 * to be — so a shared `repeat` tiled the same material at completely different
 * sizes on neighbouring walls, and at a different size again on every piece of
 * a wall that had been split. It reads as a texture-scale jump from across the
 * room and as plainly wrong UVs once you walk up to it.
 *
 * Projecting from metric position along each face's dominant axis makes tile
 * size depend on the surface's real dimensions instead of its construction.
 * `offset` moves the projection into the parent's space so pieces of one wall
 * keep a continuous pattern across their shared edges, and dividing by the
 * texture's own repeat lets this run without disturbing the other materials
 * that share these maps.
 */
export function applyMetricSurfaceUvs(
  geometry: THREE.BufferGeometry,
  {
    offset = [0, 0, 0],
    tilesPerMetre,
    textureRepeat,
  }: {
    offset?: readonly [number, number, number];
    tilesPerMetre: number;
    textureRepeat: THREE.Vector2;
  },
) {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  if (!position || !normal) return;
  const scaleU = tilesPerMetre / (textureRepeat.x || 1);
  const scaleV = tilesPerMetre / (textureRepeat.y || 1);
  const uvs = new Float32Array(position.count * 2);
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const x = position.getX(vertex) + offset[0];
    const y = position.getY(vertex) + offset[1];
    const z = position.getZ(vertex) + offset[2];
    const nx = Math.abs(normal.getX(vertex));
    const ny = Math.abs(normal.getY(vertex));
    const nz = Math.abs(normal.getZ(vertex));
    let u: number;
    let v: number;
    if (nx >= ny && nx >= nz) {
      // Reveals down the side of a window opening, and wall end caps.
      u = z;
      v = y;
    } else if (ny >= nz) {
      // Floors, ceilings and the tops of walls.
      u = x;
      v = z;
    } else {
      // The room-facing plane of a wall.
      u = x;
      v = y;
    }
    uvs[vertex * 2] = u * scaleU;
    uvs[vertex * 2 + 1] = v * scaleV;
  }
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
}

