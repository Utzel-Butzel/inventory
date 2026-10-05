import { z } from "zod";
import { canAccessResource, requireResourcePermission } from "@/lib/api-auth";
import { assemblyHttpError, customizeAssemblyConfiguration, previewAssemblyConfiguration } from "@/lib/assemblies";

const selectionSchema = z.record(
  z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/), z.string().uuid(),
).refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 100);
type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";

async function handle(request: Request, context: Context, customize: boolean) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success)
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  const permission = customize ? "inventory.update" : "inventory.read";
  const authorization = await requireResourcePermission(request, permission, id);
  if (authorization.response) return authorization.response;
  if (customize && !authorization.identity.permissions.includes("inventory.create"))
    return Response.json({ error: "Creating a finished variant requires inventory.create." }, { status: 403 });
  let input: unknown;
  try {
    input = customize ? await request.json() : JSON.parse(new URL(request.url).searchParams.get("selection") ?? "null");
  } catch {
    return Response.json({ error: "Invalid configuration." }, { status: 422 });
  }
  const parsed = selectionSchema.safeParse(input);
  if (!parsed.success) return Response.json({ error: "Invalid configuration." }, { status: 422 });
  try {
    const authorize = (resource: Parameters<typeof canAccessResource>[2]) =>
      canAccessResource(authorization.identity, permission, resource);
    const result = customize
      ? await customizeAssemblyConfiguration(authorization.identity.organizationId, id, parsed.data, authorization.identity.subject, authorize)
      : await previewAssemblyConfiguration(authorization.identity.organizationId, id, parsed.data, authorize);
    return Response.json(result);
  } catch (error) {
    const failure = assemblyHttpError(error, "Unable to resolve the finished configuration.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
export const GET = (request: Request, context: Context) => handle(request, context, false);
export const POST = (request: Request, context: Context) => handle(request, context, true);
