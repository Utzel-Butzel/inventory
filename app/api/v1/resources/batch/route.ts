import { requireIdentity } from "@/lib/api-auth";
import { updateResourcesBatch } from "@/lib/resources";
import { resourceBatchPatchSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const authorization = await requireIdentity(request, "write");
  if (authorization.response) return authorization.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }

  const parsed = resourceBatchPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid batch update.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const result = await updateResourcesBatch(parsed.data);
    return Response.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "BATCH_RESOURCE_NOT_FOUND") {
      return Response.json(
        { error: "At least one selected inventory item no longer exists." },
        { status: 404 },
      );
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to update selected items." },
      { status: 500 },
    );
  }
}
