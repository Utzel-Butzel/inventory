import { requireSessionPermission } from "@/lib/api-auth";
import { publicShareCreateSchema } from "@/lib/public-share-contract";
import {
  createPublicShare,
  listPublicShares,
  PublicShareError,
} from "@/lib/public-shares";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const authorization = await requireSessionPermission(request, "sharing.manage");
  if (authorization.response) return authorization.response;
  const shares = await listPublicShares();
  return Response.json({ shares }, { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  const authorization = await requireSessionPermission(request, "sharing.manage");
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 400, headers: noStoreHeaders },
    );
  }
  const parsed = publicShareCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid public share.", details: parsed.error.flatten() },
      { status: 422, headers: noStoreHeaders },
    );
  }
  try {
    const share = await createPublicShare(
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ share }, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof PublicShareError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers: noStoreHeaders },
      );
    }
    throw error;
  }
}
