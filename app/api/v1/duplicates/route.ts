import { z } from "zod";

import { requireIdentity } from "@/lib/api-auth";
import { findDuplicateResources, mergeResources } from "@/lib/resources";

const mergeSchema = z.object({
  keepResourceId: z.string().uuid(),
  removeResourceId: z.string().uuid(),
});

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requireIdentity(request, "read");
  if (authorization.response) return authorization.response;
  return Response.json({ duplicates: await findDuplicateResources() });
}

export async function POST(request: Request) {
  const authorization = await requireIdentity(request, "write");
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const parsed = mergeSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid merge request." }, { status: 422 });
  }
  try {
    const resource = await mergeResources(
      parsed.data.keepResourceId,
      parsed.data.removeResourceId,
      authorization.identity.subject,
    );
    if (!resource) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ resource });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to merge items.";
    const stockConflict =
      message.includes("bulk units into serialized stock") ||
      message.includes("no longer exists") ||
      message.includes("circular bill of materials") ||
      message.includes("assembly build history") ||
      message.includes("purchase-order history") ||
      message.includes("3D room scans");
    return Response.json(
      { error: message },
      { status: stockConflict ? 409 : 500 },
    );
  }
}
