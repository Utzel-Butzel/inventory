import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

export const dynamic = "force-static";

const openApiDocument = parse(
  readFileSync(join(process.cwd(), "public", "openapi.yaml"), "utf8"),
);

export function GET() {
  return Response.json(openApiDocument, {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Disposition": 'inline; filename="openapi.json"',
      "X-Content-Type-Options": "nosniff",
    },
  });
}
