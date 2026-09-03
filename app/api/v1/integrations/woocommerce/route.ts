import { requireSessionPermission } from "@/lib/api-auth";
import { wooCommerceConnectionInputSchema } from "@/lib/woocommerce-contract";
import { wooCommerceSyncPatchSchema } from "@/lib/woocommerce-sync-contract";
import {
  disableWooCommerceStockSync,
  getWooCommerceSyncOverview,
  setWooCommerceStockSyncEnabled,
  WooCommerceSyncError,
} from "@/lib/woocommerce-sync";
import {
  connectWooCommerce,
  disconnectWooCommerce,
  getWooCommerceConnection,
  isWooCommerceEncryptionConfigured,
  WooCommerceConfigurationError,
  WooCommerceConnectionError,
} from "@/lib/woocommerce";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const authorization = await requireSessionPermission(
    request,
    "webhooks.manage",
  );
  if (authorization.response) return authorization.response;
  const connection = await getWooCommerceConnection(
    authorization.identity.organizationId,
  );
  return Response.json(
    {
      connection,
      sync: connection
        ? await getWooCommerceSyncOverview(
            authorization.identity.organizationId,
            connection.id,
          )
        : null,
      encryptionConfigured: isWooCommerceEncryptionConfigured(),
    },
    { headers: noStoreHeaders },
  );
}

export async function PATCH(request: Request) {
  const authorization = await requireSessionPermission(
    request,
    "webhooks.manage",
  );
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 400 },
    );
  }
  const parsed = wooCommerceSyncPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid WooCommerce sync settings.",
        details: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }
  try {
    const connection = await setWooCommerceStockSyncEnabled(
      authorization.identity.organizationId,
      parsed.data.syncEnabled,
      authorization.identity.subject,
    );
    return Response.json(
      {
        connection,
        sync: connection
          ? await getWooCommerceSyncOverview(
              authorization.identity.organizationId,
              connection.id,
            )
          : null,
        encryptionConfigured: isWooCommerceEncryptionConfigured(),
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof WooCommerceConfigurationError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof WooCommerceConnectionError) {
      return Response.json({ error: error.message }, { status: 502 });
    }
    if (error instanceof WooCommerceSyncError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function PUT(request: Request) {
  const authorization = await requireSessionPermission(
    request,
    "webhooks.manage",
  );
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 400 },
    );
  }
  const parsed = wooCommerceConnectionInputSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid WooCommerce connection settings.",
        details: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }
  try {
    return Response.json(
      await connectWooCommerce(
        authorization.identity.organizationId,
        parsed.data,
        authorization.identity.subject,
      ),
      { headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof WooCommerceConfigurationError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof WooCommerceConnectionError) {
      return Response.json({ error: error.message }, { status: 502 });
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("WooCommerce store URL")) {
      return Response.json({ error: message }, { status: 422 });
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  const authorization = await requireSessionPermission(
    request,
    "webhooks.manage",
  );
  if (authorization.response) return authorization.response;
  await disableWooCommerceStockSync(
    authorization.identity.organizationId,
    authorization.identity.subject,
  );
  await disconnectWooCommerce(authorization.identity.organizationId);
  return new Response(null, { status: 204, headers: noStoreHeaders });
}
