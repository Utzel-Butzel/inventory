import { z } from "zod";

import { requireResourcePermission } from "@/lib/api-auth";
import { createStockUnits, listStockUnits, stockHttpError } from "@/lib/stock";
import { customFieldValuesInputSchema } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };

const metadataSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 50_000, {
    message: "Metadata must be 50 KB or smaller.",
  });

const unitCreateSchema = z
  .object({
    count: z.number().int().min(1).max(100).optional(),
    code: z.string().trim().min(1).max(180).optional(),
    codes: z.array(z.string().trim().min(1).max(180)).min(1).max(100).optional(),
    location: z.string().trim().max(240).nullable().optional(),
    locationResourceId: z.string().uuid().nullable().optional(),
    metadata: metadataSchema.optional(),
    customFields: customFieldValuesInputSchema.optional(),
    acquiredAt: z.string().datetime().optional(),
    totalPriceCents: z.number().int().min(0).max(2_000_000_000).nullable().optional(),
    priceCurrency: z.string().trim().length(3).toUpperCase().nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.totalPriceCents == null) !== (value.priceCurrency == null)) {
      context.addIssue({
        code: "custom",
        path: [value.totalPriceCents == null ? "totalPriceCents" : "priceCurrency"],
        message: "totalPriceCents and priceCurrency must be supplied together.",
      });
    }
    if (value.code && value.codes) {
      context.addIssue({
        code: "custom",
        message: "Use either code or codes, not both.",
        path: ["codes"],
      });
    }
    if (value.code && value.count !== undefined && value.count !== 1) {
      context.addIssue({
        code: "custom",
        message: "A single code can only create one unit.",
        path: ["count"],
      });
    }
    if (value.codes && value.count !== undefined && value.count !== value.codes.length) {
      context.addIssue({
        code: "custom",
        message: "count must match the number of codes.",
        path: ["count"],
      });
    }
    if (value.codes && new Set(value.codes).size !== value.codes.length) {
      context.addIssue({
        code: "custom",
        message: "Unit codes must be unique within the request.",
        path: ["codes"],
      });
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

  try {
    const units = await listStockUnits(
      authorization.identity.organizationId,
      id,
    );
    if (!units) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ units });
  } catch {
    return Response.json(
      { error: "Unable to load serialized units." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }
  const authorization = await requireResourcePermission(
    request,
    "stock.manage",
    id,
  );
  if (authorization.response) return authorization.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = unitCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid serialized unit request.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const result = await createStockUnits(
      authorization.identity.organizationId,
      id,
      {
        ...parsed.data,
        acquiredAt: parsed.data.acquiredAt
          ? new Date(parsed.data.acquiredAt)
          : undefined,
      },
      authorization.identity.subject,
    );
    return Response.json(result, { status: 201 });
  } catch (error) {
    const failure = stockHttpError(error, "Unable to create serialized units.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
