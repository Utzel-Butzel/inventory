import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import {
  AmbiguousResourceCodeError,
  lookupResourceByCode,
} from "@/lib/resource-lookup";

export const dynamic = "force-dynamic";

const codeSchema = z.string().trim().min(1).max(2_048);

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "inventory.read");
  if (authorization.response) return authorization.response;

  const parsed = codeSchema.safeParse(new URL(request.url).searchParams.get("code"));
  if (!parsed.success) {
    return Response.json(
      { error: "Provide a QR or barcode value in the code query parameter." },
      { status: 400 },
    );
  }

  try {
    const result = await lookupResourceByCode(
      authorization.identity.organizationId,
      parsed.data,
    );
    if (!result) {
      return Response.json({ error: "No inventory item matches this code." }, { status: 404 });
    }
    return Response.json(result);
  } catch (error) {
    if (error instanceof AmbiguousResourceCodeError) {
      return Response.json(
        { error: "This serial number is assigned to more than one inventory item." },
        { status: 409 },
      );
    }
    throw error;
  }
}
