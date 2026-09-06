/**
 * The architectural key/fill rig shared by the realistic lightmap bake and the
 * raster view that displays it.
 *
 * Both consumers must agree on the light directions and their relative
 * strengths: the bake stores diffuse irradiance for the static shell, while the
 * runtime keeps a matching real-time key light so movable furniture drops
 * contact shadows in the same direction as the baked ones. Keeping the numbers
 * in one pure module also lets the contract test assert the photographic rules
 * (key elevation, key-to-fill ratio, camera separation) without a GPU.
 */

/** Key elevation above the horizon, inside the architectural 35-55 degree band. */
export const roomKeyLightElevationDegrees = 46;

/** Minimum azimuth separation between the key and the viewing direction. */
export const roomKeyLightCameraSeparationDegrees = 28;

/**
 * Key-to-fill lighting ratio, measured the photographic way: the two sources'
 * irradiance on the same horizontal surface.
 *
 * Photographic interiors sit between 2:1 and 3:1. This rig takes the top of
 * that band because the key only reaches the room through its glazing while the
 * fill reaches all of it, so a lower number lets the fill flatten the sunlight
 * out of the picture entirely.
 */
export const roomKeyToFillRatio = 3;

/** Warm daylight key, roughly 5200 K sunlight after atmospheric warming. */
export const roomKeyLightColor = 0xffe8d2;

/** Cool sky fill, the complementary bounce that keeps corners from blocking up. */
export const roomFillLightColor = 0xe4edfa;

/**
 * Irradiance (lux-like, matching THREE.DirectionalLight.intensity) of the key.
 *
 * A lambertian surface returns `irradiance * albedo / PI`, and the fill reaches
 * a vertical wall well off its axis, so the figure that matters is several
 * times what the on-axis floor arithmetic suggests. This value puts a lit wall
 * in the upper-middle of the display range with the corners still open.
 */
export const roomKeyLightIrradiance = 15;

/**
 * Flat ambient kept in the runtime raster pass.
 *
 * Ambient light is the same from every direction, so it is exactly what makes a
 * box read as one dull colour on all six faces. Every opaque surface takes its
 * shading from the atlas; this is only here so glass, polished metal and splats
 * are not black cut-outs, and it has to stay small enough not to compete.
 */
export const roomAmbientBounceFraction = 0.05;

const degreesToRadians = Math.PI / 180;
const radiansToDegrees = 180 / Math.PI;

/** Signed smallest angle between two azimuths, in degrees. */
export function azimuthSeparationDegrees(left: number, right: number) {
  const difference = ((left - right) % 360 + 540) % 360 - 180;
  return Math.abs(difference);
}

/** Azimuth of a horizontal direction, measured from +Z toward +X. */
export function azimuthDegrees(x: number, z: number) {
  return Math.atan2(x, z) * radiansToDegrees;
}

/**
 * Unit vector pointing from the room toward the key light.
 *
 * `azimuth` is measured from +Z toward +X so it composes with
 * {@link azimuthDegrees}; `elevation` is the angle above the horizon.
 */
export function roomKeyLightDirection(
  azimuth: number,
  elevation = roomKeyLightElevationDegrees,
): [number, number, number] {
  const azimuthRadians = azimuth * degreesToRadians;
  const elevationRadians = elevation * degreesToRadians;
  const horizontal = Math.cos(elevationRadians);
  return [
    Math.sin(azimuthRadians) * horizontal,
    Math.sin(elevationRadians),
    Math.cos(azimuthRadians) * horizontal,
  ];
}

/**
 * Chooses the key azimuth for a room.
 *
 * Daylight should enter through the room's largest window, so the preferred
 * azimuth sits outside that wall. The result is then pushed away from the
 * viewing azimuth: a key that shares the camera's direction flattens every
 * surface the cutaway is meant to describe.
 */
export function resolveRoomKeyAzimuth({
  cameraAzimuth,
  separation = roomKeyLightCameraSeparationDegrees,
  windowAzimuth = null,
}: {
  cameraAzimuth: number;
  separation?: number;
  windowAzimuth?: number | null;
}) {
  const preferred = windowAzimuth ?? cameraAzimuth + 3 * separation;
  if (azimuthSeparationDegrees(preferred, cameraAzimuth) >= separation) {
    return ((preferred % 360) + 360) % 360;
  }
  // Rotate the key to whichever side of the camera it already leans toward so
  // window light keeps entering from its measured side of the room.
  const difference = ((preferred - cameraAzimuth) % 360 + 540) % 360 - 180;
  const rotated = cameraAzimuth + (difference >= 0 ? separation : -separation);
  return ((rotated % 360) + 360) % 360;
}

/**
 * Cosine-weighted configuration factor from a point on the axis through the
 * centre of a `width` x `height` rectangle at `distance`.
 *
 * This is the closed-form solution for the four corner rectangles that make up
 * a centred one, and is exact for a Lambertian emitter.
 */
export function rectAreaConfigurationFactor(
  width: number,
  height: number,
  distance: number,
) {
  if (!(width > 0) || !(height > 0) || !(distance > 0)) return 0;
  const a = width / 2 / distance;
  const b = height / 2 / distance;
  const first = (a / Math.sqrt(1 + a * a)) * Math.atan(b / Math.sqrt(1 + a * a));
  const second = (b / Math.sqrt(1 + b * b)) * Math.atan(a / Math.sqrt(1 + b * b));
  return (4 * (first + second)) / (2 * Math.PI);
}

/**
 * Irradiance the key delivers to a horizontal surface.
 *
 * `roomKeyLightIrradiance` is measured perpendicular to the beam, which is not
 * what a floor receives from a light standing at `elevation` above it. Comparing
 * the fill against the perpendicular figure quietly overstates the key and
 * leaves the fill too strong.
 */
export function roomKeyFloorIrradiance(
  keyIrradiance = roomKeyLightIrradiance,
  elevation = roomKeyLightElevationDegrees,
) {
  return keyIrradiance * Math.sin(elevation * degreesToRadians);
}

/**
 * Radiance a rectangular fill source needs so the irradiance it delivers on the
 * axis below it equals the key's floor irradiance divided by `ratio`.
 *
 * Irradiance from a Lambertian rectangle is `PI * radiance * configurationFactor`,
 * so the fill's nit value follows directly from the ratio we want to hit.
 */
export function roomFillRadianceForKey({
  distance,
  elevation = roomKeyLightElevationDegrees,
  height,
  keyIrradiance = roomKeyLightIrradiance,
  ratio = roomKeyToFillRatio,
  width,
}: {
  distance: number;
  elevation?: number;
  height: number;
  keyIrradiance?: number;
  ratio?: number;
  width: number;
}) {
  const factor = rectAreaConfigurationFactor(width, height, distance);
  if (factor <= 0) return 0;
  return (
    roomKeyFloorIrradiance(keyIrradiance, elevation) /
    ratio /
    (Math.PI * factor)
  );
}

/**
 * Where the key panel hangs inside the room shell.
 *
 * The panel has to sit under the ceiling: anything placed along the key vector
 * at arm's length from the room centre ends up above the roof, where the
 * enclosure blocks it exactly as it blocks a distant sun. Solving the offset
 * from the ceiling clearance keeps the specified elevation while guaranteeing
 * the source is inside. A room too shallow to hold the full offset keeps the
 * angle and lowers the panel instead of tilting it.
 */
export function roomKeyPanelPlacement({
  ceilingClearance,
  centerHeight,
  elevation = roomKeyLightElevationDegrees,
  maximumHorizontal,
}: {
  ceilingClearance: number;
  centerHeight: number;
  elevation?: number;
  maximumHorizontal: number;
}) {
  const tangent = Math.tan(elevation * degreesToRadians);
  let rise = Math.max(ceilingClearance - centerHeight, 0.2);
  let horizontal = rise / tangent;
  if (horizontal > maximumHorizontal) {
    horizontal = maximumHorizontal;
    rise = horizontal * tangent;
  }
  return {
    distance: Math.hypot(horizontal, rise),
    /** Actual elevation of the panel seen from the room centre, in degrees. */
    elevation: Math.atan2(rise, horizontal) * radiansToDegrees,
    horizontal,
    rise,
  };
}

/**
 * Radiance the key panel needs so a surface facing it, at `distance`, receives
 * `keyIrradiance`.
 *
 * The key is realised as a broad tilted panel rather than a distant sun. A
 * sealed room is exactly what a distant directional light cannot enter: its
 * shadow rays run to infinity and the ceiling stops every one that does not
 * happen to line up with a window, which leaves the key lighting a patch of
 * floor instead of the room. Putting the source inside the shell keeps the
 * specified direction and elevation while letting the enclosure go on doing its
 * real job, which is containing the bounce.
 */
export function roomKeyRadianceForPanel({
  distance,
  height,
  keyIrradiance = roomKeyLightIrradiance,
  width,
}: {
  distance: number;
  height: number;
  keyIrradiance?: number;
  width: number;
}) {
  const factor = rectAreaConfigurationFactor(width, height, distance);
  if (factor <= 0) return 0;
  return keyIrradiance / (Math.PI * factor);
}

/**
 * Irradiance a rectangular source of `radiance` delivers on its centre axis.
 * The inverse of {@link roomFillRadianceForKey}, used by the contract test.
 */
export function rectAreaAxialIrradiance({
  distance,
  height,
  radiance,
  width,
}: {
  distance: number;
  height: number;
  radiance: number;
  width: number;
}) {
  return Math.PI * radiance * rectAreaConfigurationFactor(width, height, distance);
}
