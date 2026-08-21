import { eq } from "drizzle-orm";

import { users } from "@/db/schema";
import { requireIdentity } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { isInventoryPageSize } from "@/lib/inventory-pagination";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store" };

export async function PATCH(request: Request) {
  const authorization = await requireIdentity(request, "read");
  if (authorization.response) return authorization.response;
  if (
    authorization.identity.kind !== "session" ||
    !authorization.identity.userId ||
    authorization.identity.organization.isReadOnly
  ) {
    return Response.json(
      { error: "User preferences require a writable browser session." },
      { status: 403, headers: noStoreHeaders },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return Response.json(
      { error: "Expected a preferences object." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const hasInventoryPageSize = Object.hasOwn(payload, "inventoryPageSize");
  const hasDeveloperMode = Object.hasOwn(payload, "developerMode");
  if (!hasInventoryPageSize && !hasDeveloperMode) {
    return Response.json(
      { error: "No supported preferences were provided." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const inventoryPageSize = (payload as { inventoryPageSize?: unknown })
    .inventoryPageSize;
  const updates: {
    inventoryPageSize?: number;
    developerMode?: boolean;
  } = {};
  if (hasInventoryPageSize) {
    if (!isInventoryPageSize(inventoryPageSize)) {
      return Response.json(
        { error: "Inventory page size must be 50, 100, 200, or 500." },
        { status: 422, headers: noStoreHeaders },
      );
    }
    updates.inventoryPageSize = inventoryPageSize;
  }
  const developerMode = (payload as { developerMode?: unknown }).developerMode;
  if (hasDeveloperMode) {
    if (typeof developerMode !== "boolean") {
      return Response.json(
        { error: "Developer mode must be true or false." },
        { status: 422, headers: noStoreHeaders },
      );
    }
    updates.developerMode = developerMode;
  }

  const [user] = await db
    .update(users)
    .set({
      ...updates,
      updatedBy: authorization.identity.subject,
      updatedAt: new Date(),
    })
    .where(eq(users.id, authorization.identity.userId))
    .returning({
      inventoryPageSize: users.inventoryPageSize,
      developerMode: users.developerMode,
    });
  if (!user) {
    return Response.json(
      { error: "User not found." },
      { status: 404, headers: noStoreHeaders },
    );
  }

  return Response.json(
    {
      preferences: {
        inventoryPageSize: user.inventoryPageSize,
        developerMode: user.developerMode,
      },
    },
    { headers: noStoreHeaders },
  );
}
