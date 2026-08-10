import { z } from "zod";

import { requireIdentity } from "@/lib/api-auth";
import {
  assemblyHttpError,
  getBom,
  replaceBom,
} from "@/lib/assemblies";

type Context = { params: Promise<{ id: string }> };

const bomSchema = z
  .object({
    components: z
      .array(
        z
          .object({
            resourceId: z.string().uuid(),
            quantityPerAssembly: z.number().int().min(1).max(2_000_000_000),
            position: z.number().int().min(0).max(2_000_000_000).optional(),
            note: z.string().trim().max(20_000).optional(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.components.forEach((component, index) => {
      if (seen.has(component.resourceId)) {
        context.addIssue({
          code: "custom",
          path: ["components", index, "resourceId"],
          message: "Each component may appear only once in a bill of materials.",
        });
      }
      seen.add(component.resourceId);
    });
  });

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const authorization = await requireIdentity(request, "read");
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }

  try {
    const result = await getBom(id);
    if (!result) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(result);
  } catch (error) {
    const failure = assemblyHttpError(error, "Unable to load this bill of materials.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

export async function PUT(request: Request, context: Context) {
  const authorization = await requireIdentity(request, "write");
  if (authorization.response) return authorization.response;
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
  const parsed = bomSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid bill of materials.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    return Response.json(await replaceBom(id, parsed.data.components));
  } catch (error) {
    const failure = assemblyHttpError(error, "Unable to replace this bill of materials.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
