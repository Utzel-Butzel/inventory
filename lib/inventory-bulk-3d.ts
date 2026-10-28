import { z } from "zod";

export const bulk3dVersion = "mapanything_manual_v1";
export const bulk3dModel = "facebook/map-anything";
export const bulk3dLifetimeMs = 24 * 60 * 60_000;
export const bulk3dDeadlineMs = 10 * 60_000;
export const bulk3dMaxImages = 4;
export const bulk3dMaxImageBytes = 8 * 1024 * 1024;
export const bulk3dMaxUploadBytes = bulk3dMaxImages * bulk3dMaxImageBytes + 64 * 1024;
export const imagePointSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
export type ImagePoint = z.infer<typeof imagePointSchema>;
export type ImageEdge = [ImagePoint, ImagePoint];

export function polygonArea(points: ImagePoint[]) {
  return Math.abs(points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2;
}

function inside(point: ImagePoint, polygon: ImagePoint[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0]) result = !result;
  }
  return result;
}

function simplePolygon(polygon: ImagePoint[]) {
  const cross = (a: ImagePoint, b: ImagePoint, c: ImagePoint) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i+1)%polygon.length];
    if (Math.hypot(a[0]-b[0], a[1]-b[1]) < .002) return false;
    for (let j = i+2; j < polygon.length; j++) {
      if (i === 0 && j === polygon.length-1) continue;
      const c = polygon[j], d = polygon[(j+1)%polygon.length];
      const boxesOverlap = Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0])) <= Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))
        && Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1])) <= Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1]));
      if (boxesOverlap && cross(a,b,c)*cross(a,b,d) <= 0 && cross(c,d,a)*cross(c,d,b) <= 0) return false;
    }
  }
  return true;
}

export const bulk3dInputSchema = z.object({
  itemId: z.string().uuid(),
  language: z.enum(["de", "en"]),
  marks: z.object({
    // Coordinates in the first, oriented input photo, independent of display size.
    pile: z.array(imagePointSchema).min(4).max(20),
    table: z.array(imagePointSchema).length(3),
    edges: z.array(z.tuple([imagePointSchema, imagePointSchema])).min(3).max(20),
  }).strict(),
  assumptions: z.object({
    shape: z.enum(["ellipsoid", "cuboid", "triangular_prism"]),
    widthRatio: z.number().min(.1).max(2),
    heightRatio: z.number().min(.1).max(2),
    packing: z.number().min(.1).max(1),
    floorOffset: z.number().min(0).max(3),
  }).strict(),
}).strict().superRefine(({ marks }, ctx) => {
  if (polygonArea(marks.table) < .002 || polygonArea(marks.pile) < .002) {
    ctx.addIssue({ code: "custom", path: ["marks"], message: "Spread the reference points and outline a visible fill area." });
  }
  if (marks.edges.some(([a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < .005)) {
    ctx.addIssue({ code: "custom", path: ["marks", "edges"], message: "Mark the two distinct ends of each part." });
  }
  if (!simplePolygon(marks.pile) || marks.table.some((p) => inside(p, marks.pile)) || marks.edges.some(([a,b]) => !inside([(a[0]+b[0])/2, (a[1]+b[1])/2], marks.pile))) {
    ctx.addIssue({ code: "custom", path: ["marks"], message: "Use a simple outline, samples within the fill area and table points outside it." });
  }
});
export type Bulk3dInput = z.infer<typeof bulk3dInputSchema>;

const count = z.number().int().min(1).max(1_000_000);
export const bulk3dResultSchema = z.object({
  method: z.literal("bulk_3d"),
  version: z.literal(bulk3dVersion),
  model: z.literal(bulk3dModel),
  isExact: z.literal(false),
  accuracyValidated: z.literal(false),
  estimate: z.object({ count, lowerBound: z.number().int().min(0).max(1_000_000), upperBound: count }).strict().nullable(),
  warningCodes: z.array(z.enum(["hiddenBottom", "partShape", "manualMarks", "geometry", "sampleSpread"])).max(5),
  imageCount: z.number().int().min(3).max(4),
  sampleCount: z.number().int().min(3).max(20),
  inferenceSeconds: z.number().nonnegative().max(600),
}).strict().superRefine(({ estimate }, ctx) => {
  if (estimate && (estimate.lowerBound > estimate.count || estimate.count > estimate.upperBound || estimate.lowerBound === estimate.upperBound)) {
    ctx.addIssue({ code: "custom", path: ["estimate"], message: "Invalid estimate range." });
  }
});
export type Bulk3dResult = z.infer<typeof bulk3dResultSchema>;
export type Bulk3dAppliedResult = NonNullable<Bulk3dResult["estimate"]> & { method: "bulk_3d"; model: string };
export const bulk3dJobSchema = z.object({ jobId: z.string().uuid(), expiresAt: z.string().datetime() }).strict();
export const bulk3dStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.enum(["queued", "loading", "reconstructing", "analyzing"]) }).strict(),
  z.object({ status: z.literal("completed"), result: bulk3dResultSchema }).strict(),
  z.object({ status: z.literal("failed"), code: z.enum(["analysisFailed", "timeout"]) }).strict(),
]);
