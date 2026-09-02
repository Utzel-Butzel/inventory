import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import { listLoanAssignments } from "@/lib/inventory-assignments";

export const dynamic = "force-dynamic";

const limitSchema = z.coerce.number().int().min(1).max(500).default(500);

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "assignments.read");
  if (authorization.response) return authorization.response;

  const parsed = limitSchema.safeParse(
    new URL(request.url).searchParams.get("limit") ?? undefined,
  );
  if (!parsed.success) {
    return Response.json(
      { error: "limit must be between 1 and 500." },
      { status: 422 },
    );
  }
  const result = await listLoanAssignments(
    authorization.identity.organizationId,
    parsed.data,
  );
  return Response.json(
    {
      ...result,
      capabilities: {
        canManage: authorization.identity.permissions.includes(
          "assignments.manage",
        ),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
