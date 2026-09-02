import {
  hashIdempotentPayload,
  idempotencyResponseHeaders,
  readIdempotencyKey,
} from "@/lib/idempotency";
import { publicStockBookingSchema } from "@/lib/public-share-contract";
import {
  isSameOriginRequest,
  publicShareNoStoreHeaders,
  requirePublicStockShare,
} from "@/lib/public-share-session";
import { bookStockMovement, stockHttpError } from "@/lib/stock";

type Context = {
  params: Promise<{ shareId: string; resourceId: string }>;
};

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: Context) {
  if (!isSameOriginRequest(request)) {
    return Response.json(
      { error: "Cross-origin stock bookings are not allowed." },
      { status: 403, headers: publicShareNoStoreHeaders() },
    );
  }
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  if (!idempotency.key) {
    return Response.json(
      { error: "Idempotency-Key header is required." },
      { status: 400, headers: publicShareNoStoreHeaders() },
    );
  }
  const { shareId, resourceId } = await context.params;
  const authorization = await requirePublicStockShare(
    request,
    shareId,
    resourceId,
  );
  if (authorization.response) return authorization.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 400, headers: publicShareNoStoreHeaders() },
    );
  }
  const parsed = publicStockBookingSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid stock booking.", details: parsed.error.flatten() },
      { status: 422, headers: publicShareNoStoreHeaders() },
    );
  }

  const delta =
    parsed.data.action === "in" ? parsed.data.quantity : -parsed.data.quantity;
  const actor = `public-share:${authorization.share.id}`;
  try {
    const result = await bookStockMovement(
      authorization.share.organizationId,
      resourceId,
      {
        delta,
        quantity: parsed.data.quantity,
        type: parsed.data.action === "in" ? "receipt" : "issue",
        reason: "Public stock tool",
        note: parsed.data.note,
      },
      actor,
      {
        key: idempotency.key,
        requestHash: hashIdempotentPayload({ shareId, resourceId, ...parsed.data }),
      },
    );
    const response = result.response as {
      resource: { id: string; name: string; quantity: number };
      movement: {
        id: string;
        delta: number;
        balanceAfter: number;
        type: string;
        reason: string | null;
        note: string;
        occurredAt: string;
      };
    };
    return Response.json(
      {
        resource: {
          id: response.resource.id,
          name: response.resource.name,
          quantity: response.resource.quantity,
        },
        movement: response.movement,
      },
      {
        status: result.replayed ? 200 : 201,
        headers: {
          ...publicShareNoStoreHeaders(),
          ...idempotencyResponseHeaders(idempotency.key, result.replayed),
        },
      },
    );
  } catch (error) {
    const failure = stockHttpError(error, "Unable to book this stock movement.");
    return Response.json(
      { error: failure.message },
      { status: failure.status, headers: publicShareNoStoreHeaders() },
    );
  }
}
