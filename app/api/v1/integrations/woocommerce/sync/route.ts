import { requireSessionPermission } from "@/lib/api-auth";
import {
  runManualWooCommerceSync,
  WooCommerceSyncError,
} from "@/lib/woocommerce-sync";
import { wooCommerceManualSyncSchema } from "@/lib/woocommerce-sync-contract";
import {
  WooCommerceConfigurationError,
  WooCommerceConnectionError,
} from "@/lib/woocommerce";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authorization = await requireSessionPermission(
    request,
    "webhooks.manage",
  );
  if (authorization.response) return authorization.response;
  let payload: unknown = {};
  const body = await request.text();
  if (body.trim()) {
    try {
      payload = JSON.parse(body);
    } catch {
      return Response.json(
        { error: "Expected a JSON request body." },
        { status: 400 },
      );
    }
  }
  const parsed = wooCommerceManualSyncSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid WooCommerce sync request.",
        details: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }
  try {
    return Response.json(
      await runManualWooCommerceSync(
        authorization.identity.organizationId,
        parsed.data,
      ),
      { headers: { "Cache-Control": "no-store" } },
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
