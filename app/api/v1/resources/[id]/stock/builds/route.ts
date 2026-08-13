import { z } from "zod";

import {
  canAccessResource,
  requireIdentity,
  requireResourcePermission,
} from "@/lib/api-auth";
import {
  assemblyHttpError,
  buildAssembly,
  listAssemblyBuilds,
} from "@/lib/assemblies";
import {
  hashIdempotentPayload,
  idempotencyResponseHeaders,
  readIdempotencyKey,
} from "@/lib/idempotency";

type Context = { params: Promise<{ id: string }> };

const buildSchema = z
  .object({
    quantity: z.number().int().min(1).max(1_000),
    occurredAt: z.string().datetime().optional(),
    location: z.string().trim().max(240).nullable().optional(),
    note: z.string().trim().max(20_000).optional(),
    componentUnitIds: z
      .record(
        z.string().uuid(),
        z.array(z.string().uuid()).min(1).max(1_000),
      )
      .optional(),
    outputUnitCodes: z
      .array(z.string().trim().min(1).max(180))
      .min(1)
      .max(1_000)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.outputUnitCodes) {
      if (value.outputUnitCodes.length !== value.quantity) {
        context.addIssue({
          code: "custom",
          path: ["outputUnitCodes"],
          message: "outputUnitCodes must contain one code for every built unit.",
        });
      }
      if (new Set(value.outputUnitCodes).size !== value.outputUnitCodes.length) {
        context.addIssue({
          code: "custom",
          path: ["outputUnitCodes"],
          message: "Output unit codes must be unique within the request.",
        });
      }
    }
    for (const [resourceId, unitIds] of Object.entries(
      value.componentUnitIds ?? {},
    )) {
      if (new Set(unitIds).size !== unitIds.length) {
        context.addIssue({
          code: "custom",
          path: ["componentUnitIds", resourceId],
          message: "Component unit ids must be unique for each component.",
        });
      }
    }
  });

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }
  const authorization = await requireResourcePermission(
    request,
    "stock.read",
    id,
  );
  if (authorization.response) return authorization.response;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return Response.json({ error: "limit must be between 1 and 100." }, { status: 422 });
  }

  try {
    const result = await listAssemblyBuilds(
      authorization.identity.organizationId,
      id,
      { limit },
    );
    if (!result) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(result);
  } catch (error) {
    const failure = assemblyHttpError(error, "Unable to load assembly builds.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

export async function POST(request: Request, context: Context) {
  const authorization = await requireIdentity(request, "write");
  if (authorization.response) return authorization.response;

  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  if (!idempotency.key) {
    return Response.json(
      { error: "Idempotency-Key is required for an assembly build." },
      { status: 400 },
    );
  }
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = buildSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid assembly build.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const result = await buildAssembly(
      authorization.identity.organizationId,
      id,
      {
        ...parsed.data,
        occurredAt: parsed.data.occurredAt
          ? new Date(parsed.data.occurredAt)
          : undefined,
      },
      authorization.identity.subject,
      {
        key: idempotency.key,
        requestHash: hashIdempotentPayload({
          actor: authorization.identity.subject,
          resourceId: id,
          build: parsed.data,
        }),
      },
      (resource) =>
        canAccessResource(
          authorization.identity,
          "stock.manage",
          resource,
        ),
    );
    return Response.json(result.response, {
      status: result.replayed ? 200 : 201,
      headers: idempotencyResponseHeaders(idempotency.key, result.replayed),
    });
  } catch (error) {
    const failure = assemblyHttpError(error, "Unable to build this assembly.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
