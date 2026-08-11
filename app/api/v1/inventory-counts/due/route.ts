import { requireIdentity } from "@/lib/api-auth";
import { listDueInventoryCycles } from "@/lib/inventory-cycles";

export async function GET(request: Request) {
  const authorization = await requireIdentity(request, "read");
  if (authorization.response) return authorization.response;
  return Response.json({ due: await listDueInventoryCycles() });
}
