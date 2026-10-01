import { sql } from "drizzle-orm";
import { resources } from "@/db/schema";
import { requirePermission } from "@/lib/api-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "inventory.read");
  if (authorization.response) return authorization.response;
  const organizationId = authorization.identity.organizationId;
  // Read distinct metadata across the whole organization, independent of pagination
  // and active filters, without transferring every resource to the browser.
  const [tags, categories] = await Promise.all([
    db.execute<{ name: string }>(sql`
      SELECT DISTINCT unnest(${resources.tags}) AS name
      FROM ${resources}
      WHERE ${resources.organizationId} = ${organizationId}
      ORDER BY name
    `),
    db.execute<{ name: string }>(sql`
      SELECT DISTINCT category->>'name' AS name
      FROM ${resources}, jsonb_array_elements(${resources.categories}) AS category
      WHERE ${resources.organizationId} = ${organizationId}
      ORDER BY name
    `),
  ]);
  return Response.json({
    tags: tags.map((row) => row.name).filter(Boolean),
    categories: categories.map((row) => row.name).filter(Boolean),
  });
}
