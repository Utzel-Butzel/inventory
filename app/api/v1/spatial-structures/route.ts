import { requirePermission } from "@/lib/api-auth";
import {
  spatialStructureCreateSchema,
} from "@/lib/spatial-structure-contract";
import {
  createSpatialStructure,
  getSpatialStructure,
  listSpatialStructures,
  spatialStructureHttpError,
} from "@/lib/spatial-structures";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "spatial.read");
  if (authorization.response) return authorization.response;
  return Response.json({
    structures: await listSpatialStructures(
      authorization.identity.organizationId,
    ),
  });
}

export async function POST(request: Request) {
  const authorization = await requirePermission(request, "spatial.manage");
  if (authorization.response) return authorization.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = spatialStructureCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid spatial structure.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const structure = await createSpatialStructure(
      authorization.identity.organizationId,
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json(
      {
        structure: await getSpatialStructure(
          authorization.identity.organizationId,
          structure.id,
        ),
      },
      { status: 201 },
    );
  } catch (error) {
    const failure = spatialStructureHttpError(
      error,
      "Unable to create the spatial structure.",
    );
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
