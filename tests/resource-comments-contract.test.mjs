import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RESOURCE_COMMENT_MAX_LENGTH,
  resourceCommentCreateSchema,
} from "../lib/resource-comment-contract.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("comment bodies are trimmed, required, bounded, and strict", () => {
  assert.deepEqual(resourceCommentCreateSchema.parse({ body: "  **Ready**  " }), {
    body: "**Ready**",
  });
  assert.equal(resourceCommentCreateSchema.safeParse({ body: "   " }).success, false);
  assert.equal(
    resourceCommentCreateSchema.safeParse({
      body: "a".repeat(RESOURCE_COMMENT_MAX_LENGTH + 1),
    }).success,
    false,
  );
  assert.equal(
    resourceCommentCreateSchema.safeParse({ body: "Valid", admin: true }).success,
    false,
  );
});

test("the migration keeps comments tenant-scoped and item-owned", async () => {
  const migration = await read("../db/migrations/0036_resource_comments.sql");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS "resource_comments"/);
  assert.match(
    migration,
    /FOREIGN KEY \("organization_id", "resource_id"\)[\s\S]*REFERENCES "resources"\("organization_id", "id"\)[\s\S]*ON DELETE CASCADE/,
  );
  assert.match(migration, /length\(btrim\("body"\)\) BETWEEN 1 AND 10000/);
  assert.match(
    migration,
    /ON "resource_comments" \("organization_id", "resource_id", "created_at"\)/,
  );
});

test("comment API reads and writes through resource permissions", async () => {
  const [collection, detail, dataAccess] = await Promise.all([
    read("../app/api/v1/resources/[id]/comments/route.ts"),
    read("../app/api/v1/resources/[id]/comments/[commentId]/route.ts"),
    read("../lib/resource-comments.ts"),
  ]);

  assert.match(collection, /requireResourcePermission\([\s\S]*"inventory\.read"/);
  assert.match(collection, /requireResourcePermission\([\s\S]*"inventory\.update"/);
  assert.match(collection, /hashRequestIdentity\(authorization\.identity\)/);
  assert.match(detail, /ResourceCommentPermissionError/);
  assert.match(detail, /permissions\.includes\("users\.manage"\)/);
  assert.ok(
    dataAccess.match(/eq\(resourceComments\.organizationId,/g)?.length >= 3,
  );
  assert.ok(dataAccess.match(/eq\(resourceComments\.resourceId,/g)?.length >= 3);
});

test("inventory details expose a Markdown comment composer and renderer", async () => {
  const [page, component] = await Promise.all([
    read("../app/(dashboard)/inventory/[id]/page.tsx"),
    read("../components/resource-comments.tsx"),
  ]);

  assert.match(
    page,
    /<ResourceComments resourceId=\{resourceId\} canComment=\{canEdit\}/,
  );
  assert.match(component, /<MarkdownContent/);
  assert.match(component, /RESOURCE_COMMENT_MAX_LENGTH/);
  assert.match(component, /method: "POST"/);
  assert.match(component, /method: "PATCH"/);
  assert.match(component, /method: "DELETE"/);
});
