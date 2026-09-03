import { requireSessionPermission } from "@/lib/api-auth";
import {
  testSavedWooCommerceConnection,
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
  try {
    const result = await testSavedWooCommerceConnection(
      authorization.identity.organizationId,
      authorization.identity.subject,
    );
    if (!result) {
      return Response.json(
        { error: "No WooCommerce connection is configured." },
        { status: 404 },
      );
    }
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof WooCommerceConfigurationError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof WooCommerceConnectionError) {
      return Response.json({ error: error.message }, { status: 502 });
    }
    throw error;
  }
}
