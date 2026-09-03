import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CONTACT_COMMENT_MAX_LENGTH,
  contactCommentCreateSchema,
} from "../lib/contact-comment-contract.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("contact comments reuse the strict bounded Markdown body contract", () => {
  assert.deepEqual(contactCommentCreateSchema.parse({ body: "  **Ready**  " }), {
    body: "**Ready**",
  });
  assert.equal(contactCommentCreateSchema.safeParse({ body: "   " }).success, false);
  assert.equal(
    contactCommentCreateSchema.safeParse({
      body: "a".repeat(CONTACT_COMMENT_MAX_LENGTH + 1),
    }).success,
    false,
  );
});

test("contact comments are tenant-scoped and deleted with their contact", async () => {
  const migration = await read("../db/migrations/0057_contact_comments.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "contact_comments"/);
  assert.match(
    migration,
    /FOREIGN KEY \("organization_id", "contact_id"\)[\s\S]*REFERENCES "contacts"\("organization_id", "id"\)[\s\S]*ON DELETE CASCADE/,
  );
  assert.match(migration, /length\(btrim\("body"\)\) BETWEEN 1 AND 10000/);
});

test("contact comment API uses contact permissions and author ownership", async () => {
  const [collection, detail, dataAccess] = await Promise.all([
    read("../app/api/v1/contacts/[id]/comments/route.ts"),
    read("../app/api/v1/contacts/[id]/comments/[commentId]/route.ts"),
    read("../lib/contact-comments.ts"),
  ]);
  assert.match(collection, /requirePermission\(request, "contacts\.read"\)/);
  assert.match(collection, /requirePermission\(request, "contacts\.manage"\)/);
  assert.match(collection, /hashRequestIdentity\(authorization\.identity\)/);
  assert.match(detail, /ContactCommentPermissionError/);
  assert.match(detail, /permissions\.includes\("users\.manage"\)/);
  assert.ok(dataAccess.match(/eq\(contactComments\.organizationId,/g)?.length >= 3);
  assert.ok(dataAccess.match(/eq\(contactComments\.contactId,/g)?.length >= 3);
});

test("contacts table opens the shared Markdown comment thread", async () => {
  const [contacts, comments] = await Promise.all([
    read("../components/contacts-manager.tsx"),
    read("../components/resource-comments.tsx"),
  ]);
  assert.match(contacts, /<CommentsThread/);
  assert.match(contacts, /\/api\/v1\/contacts\/\$\{contact\.id\}\/comments/);
  assert.match(comments, /export function CommentsThread/);
  assert.match(comments, /<MarkdownContent/);
  assert.match(comments, /method: "POST"/);
  assert.match(comments, /method: "PATCH"/);
  assert.match(comments, /method: "DELETE"/);
});
