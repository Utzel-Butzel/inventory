import { z } from "zod";

import { requireIdentity } from "@/lib/api-auth";
import { spatialStructurePatchSchema } from "@/lib/spatial-structure-contract";
import {
  getSpatialStructure,
  spatialStructureHttpError,
  updateSpatialStructure,
} from "@/lib/spatial-structures";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

async function parsedId(context: Context) {
  return z.uuid().safeParse((await context.params).id);
}

export async function GET(request: Request, context: Context) {
  const authorization = await requireIdentity(request, "read");
  if (authorization.response) return authorization.response;
  const id = await parsedId(context);
  if (!id.success) {
    return Response.json({ error: "Invalid spatial structure identifier." }, { status: 422 });
  }
  const structure = await getSpatialStructure(id.data);
  if (!structure) {
    return Response.json({ error: "Spatial structure not found." }, { status: 404 });
  }
  return Response.json({ structure });
}

export async function PATCH(request: Request, context: Context) {
  const authorization = await requireIdentity(request, "write");
  if (authorization.response) return authorization.response;
  const id = await parsedId(context);
  if (!id.success) {
    return Response.json({ error: "Invalid spatial structure identifier." }, { status: 422 });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = spatialStructurePatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid spatial structure change.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const structure = await updateSpatialStructure(
      id.data,
      parsed.data,
      authorization.identity.subject,
    );
    if (!structure) {
      return Response.json({ error: "Spatial structure not found." }, { status: 404 });
    }
    return Response.json({ structure: await getSpatialStructure(structure.id) });
  } catch (error) {
    const failure = spatialStructureHttpError(
      error,
      "Unable to update the spatial structure.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
