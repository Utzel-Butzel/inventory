import { randomUUID } from "node:crypto";

import sharp from "sharp";
import { z } from "zod";

import { analyzeRoomImages } from "@/lib/ai";
import {
  consumePaidAiRateLimit,
  paidAiRateLimitHeaders,
} from "@/lib/ai-rate-limit";
import {
  canAccessResource,
  getRequestIdentity,
  requireResourcePermission,
} from "@/lib/api-auth";
import { buildRoomAiAnalysis } from "@/lib/room-ai-analysis";
import { roomObjectSuggestionPatchSchema } from "@/lib/room-ai-analysis-contract";
import { sampleRoomKeyframes } from "@/lib/room-scene-visualization";
import {
  findRoomScan,
  listRoomScanAnalysisKeyframes,
  saveRoomAiAnalysis,
  updateRoomObjectSuggestion,
} from "@/lib/room-scans";
import { readMediaBytes } from "@/lib/storage";

type Context = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const maxDuration = 180;

const imageRotation = (orientation: string) => {
  if (orientation.startsWith("right")) return 90;
  if (orientation.startsWith("left")) return -90;
  if (orientation.startsWith("down")) return 180;
  return 0;
};

const prepareKeyframe = async (
  frame: Awaited<ReturnType<typeof listRoomScanAnalysisKeyframes>>[number],
) => {
  const bytes = await readMediaBytes({
    storageKey: frame.storageKey,
    url: frame.storageUrl,
  });
  let image = sharp(bytes, { failOn: "none" }).rotate(
    imageRotation(frame.orientation),
  );
  if (frame.orientation.endsWith("mirrored")) image = image.flop();
  const prepared = await image
    .resize({
      width: 1_200,
      height: 1_200,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
  return {
    keyframeId: frame.id,
    quality: frame.quality,
    dataUrl: `data:image/jpeg;base64,${prepared.toString("base64")}`,
  };
};

async function authorizeRoomScan(
  request: Request,
  scanId: string,
  options: { requireAi: boolean },
) {
  const identity = await getRequestIdentity(request);
  if (!identity) {
    return {
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as const;
  }
  const scan = await findRoomScan(identity.organizationId, scanId);
  if (!scan) {
    return {
      response: Response.json({ error: "Room scan not found." }, { status: 404 }),
    } as const;
  }
  const permission = await requireResourcePermission(
    request,
    options.requireAi ? "ai.use" : "spatial.manage",
    scan.roomResourceId,
  );
  if (permission.response) return { response: permission.response } as const;
  if (
    !permission.identity.scopes.includes("write") ||
    !(await canAccessResource(
      permission.identity,
      "spatial.manage",
      permission.resource,
    ))
  ) {
    return {
      response: Response.json(
        { error: "You do not have permission to update this room." },
        { status: 403 },
      ),
    } as const;
  }
  return {
    response: null,
    identity: permission.identity,
    resource: permission.resource,
    scan,
  } as const;
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid room scan identifier." }, { status: 422 });
  }
  const authorization = await authorizeRoomScan(request, id, { requireAi: true });
  if (authorization.response) return authorization.response;

  const frames = await listRoomScanAnalysisKeyframes(
    authorization.identity.organizationId,
    id,
  );
  const selectedFrames = sampleRoomKeyframes(frames, 8);
  if (!selectedFrames.length) {
    return Response.json(
      { error: "This room scan has no reference photos to analyze." },
      { status: 400 },
    );
  }

  const preparedResults = await Promise.allSettled(
    selectedFrames.map(prepareKeyframe),
  );
  const images = preparedResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (!images.length) {
    return Response.json(
      { error: "The room reference photos could not be prepared." },
      { status: 502 },
    );
  }

  let limit;
  try {
    limit = await consumePaidAiRateLimit({
      organizationId: authorization.identity.organizationId,
      operation: "analyze",
      identity: authorization.identity,
    });
  } catch (error) {
    console.error("Unable to check the room AI rate limit.", error);
    return Response.json(
      { error: "AI rate limiting is temporarily unavailable." },
      { status: 503 },
    );
  }
  if (!limit.allowed) {
    return Response.json(
      {
        error: limit.disabled
          ? "AI analysis is disabled by the administrator."
          : "AI request limit reached. Try again shortly.",
      },
      { status: 429, headers: paidAiRateLimitHeaders(limit) },
    );
  }

  try {
    const { result, model } = await analyzeRoomImages({
      roomName: authorization.resource.name,
      images,
      scene: authorization.scan.scene,
    });
    const analysis = buildRoomAiAnalysis({
      detection: result,
      scene: authorization.scan.scene,
      keyframeIds: images.map((image) => image.keyframeId),
      model,
      createId: randomUUID,
    });
    const saved = await saveRoomAiAnalysis(
      authorization.identity.organizationId,
      id,
      analysis,
    );
    if (!saved) {
      return Response.json(
        { error: "Room scan not found." },
        { status: 404, headers: paidAiRateLimitHeaders(limit) },
      );
    }
    return Response.json(
      { analysis },
      { headers: paidAiRateLimitHeaders(limit) },
    );
  } catch (error) {
    console.error("Room AI analysis failed.", error);
    return Response.json(
      {
        error: error instanceof Error
          ? error.message
          : "Unable to analyze this room.",
      },
      { status: 502, headers: paidAiRateLimitHeaders(limit) },
    );
  }
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid room scan identifier." }, { status: 422 });
  }
  const authorization = await authorizeRoomScan(request, id, { requireAi: false });
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON suggestion update." }, { status: 400 });
  }
  const parsed = roomObjectSuggestionPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid suggestion update.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const result = await updateRoomObjectSuggestion(
    authorization.identity.organizationId,
    id,
    parsed.data,
  );
  if (result.kind === "updated") {
    return Response.json({ analysis: result.analysis });
  }
  if (result.kind === "scan-not-found") {
    return Response.json({ error: "Room scan not found." }, { status: 404 });
  }
  return Response.json(
    {
      error: result.kind === "analysis-not-found"
        ? "Analyze this room before reviewing suggestions."
        : "Object suggestion not found.",
    },
    { status: 404 },
  );
}
