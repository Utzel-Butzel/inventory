import postgres from "postgres";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL && existsSync(".env.local"))
  process.loadEnvFile(".env.local");
const database = new URL(
  process.env.DATABASE_URL ??
    "postgresql://inventory:inventory@localhost:5432/inventory",
);
const base = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
if (
  ![database.hostname, new URL(base).hostname].every((host) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(host),
  )
)
  throw new Error("Prompt smoke tests require a local app and local database.");
const { defaultAiPromptCollection } = await import(
  "../lib/ai-prompt-templates.ts"
);
const { resolveAiPrompt } = await import("../lib/ai-prompt-store.ts");
const sql = postgres(database.toString(), { max: 1 });
const organizations = [randomUUID(), randomUUID()],
  users = [randomUUID(), randomUUID()];
const password = randomUUID() + "!",
  suffix = randomUUID().slice(0, 8);
const emails = [
  `prompt-admin-${suffix}@example.test`,
  `prompt-editor-${suffix}@example.test`,
];
async function login(email) {
  const jar = new Map();
  const request = async (path, options = {}) => {
    const response = await fetch(base + path, {
      ...options,
      redirect: "manual",
      headers: {
        Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
        ...options.headers,
      },
    });
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(";")[0],
        pos = pair.indexOf("=");
      jar.set(pair.slice(0, pos), pair.slice(pos + 1));
    }
    return response;
  };
  const csrf = await (await request("/api/auth/csrf")).json();
  await request("/api/auth/callback/credentials", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Auth-Return-Redirect": "1",
    },
    body: new URLSearchParams({
      email,
      password,
      csrfToken: csrf.csrfToken,
      callbackUrl: base + "/inventory",
    }),
  });
  assert.equal(
    (await (await request("/api/auth/session")).json()).user?.email,
    email,
  );
  return request;
}
async function api(
  request,
  org,
  body,
  path = "/api/v1/ai/prompts",
  method = "PUT",
) {
  const response = await request(path, {
    method: body ? method : "GET",
    headers: { "X-Organization-ID": org, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
try {
  for (const [index, org] of organizations.entries()) {
    await sql`INSERT INTO organizations(id,name,slug) VALUES(${org}, 'Prompt QA', ${`prompt-qa-${suffix}-${index}`})`;
    await sql`INSERT INTO access_roles(organization_id,key,name,permissions,is_system) SELECT ${org},key,name,permissions,is_system FROM access_roles WHERE organization_id='00000000-0000-4000-8000-000000000001'`;
  }
  for (let i = 0; i < users.length; i++) {
    await sql`INSERT INTO users(id,email,name,password_hash,role) VALUES(${users[i]},${emails[i]},'Prompt QA',${await bcrypt.hash(password, 10)},${i ? "editor" : "admin"})`;
    for (const org of organizations)
      await sql`INSERT INTO organization_memberships(organization_id,user_id,role_key) VALUES(${org},${users[i]},${i ? "editor" : "admin"})`;
  }
  const [admin, editor] = await Promise.all(emails.map(login));
  assert.equal((await fetch(base + "/api/v1/ai/prompts")).status, 401);
  const original = await api(admin, organizations[0]);
  assert.equal(original.status, 200);
  assert.equal(original.body.revision, 0);
  const collection = defaultAiPromptCollection();
  const custom = {
    id: randomUUID(),
    kind: "analysis",
    name: "Workshop",
    prompt:
      "{{name}} | {{description}} | {{categories}} | {{sku}} | {{language}}",
  };
  collection.templates.push(custom);
  collection.defaults.analysis = custom.id;
  const input = { collection, revision: 0 };
  assert.equal((await api(editor, organizations[0], input)).status, 403);
  const saved = await api(admin, organizations[0], input);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 1);
  assert.deepEqual(
    (await api(editor, organizations[0])).body.collection,
    collection,
  );
  assert.deepEqual(
    (await api(admin, organizations[1])).body.collection,
    defaultAiPromptCollection(),
  );
  assert.equal((await api(admin, organizations[0], input)).status, 409);
  const invalid = structuredClone(collection);
  invalid.defaults.cover = custom.id;
  assert.equal(
    (await api(admin, organizations[0], { collection: invalid, revision: 1 }))
      .status,
    422,
  );
  const resource = {
    name: "Drill {{language}}",
    description: "Cordless",
    categories: [{ name: "Workshop" }],
    sku: "QA-123",
  };
  const rendered = await resolveAiPrompt(
    organizations[0],
    "analysis",
    {},
    resource,
  );
  assert.equal(
    rendered,
    `Drill {{language}} | Cordless | Workshop | QA-123 | ${process.env.AI_OUTPUT_LANGUAGE?.trim() || "English"}`,
  );
  assert.notEqual(
    await resolveAiPrompt(organizations[1], "analysis", {}, resource),
    rendered,
  );
  await assert.rejects(
    resolveAiPrompt(
      organizations[1],
      "analysis",
      { promptTemplateId: custom.id },
      resource,
    ),
  );
  assert.match(
    await resolveAiPrompt(
      organizations[0],
      "analysis",
      { promptTemplateId: "builtin-analysis" },
      resource,
    ),
    /cataloguing/,
  );
  await sql`INSERT INTO inventory_type_definitions(organization_id,key,label) VALUES(${organizations[0]},'object','Object')`;
  const [item] =
    await sql`INSERT INTO resources(organization_id,name,type) VALUES(${organizations[0]},'Prompt QA item','object') RETURNING id`;
  for (const action of ["analyze", "research", "image"]) {
    const result = await api(
      admin,
      organizations[0],
      {
        promptTemplateId: randomUUID(),
        ...(action === "image" ? { mode: "generate" } : {}),
      },
      `/api/v1/resources/${item.id}/${action}`,
      "POST",
    );
    assert.equal(
      result.status,
      422,
      action + " rejects unknown template before AI billing",
    );
  }
  const reset = await api(admin, organizations[0], {
    collection: defaultAiPromptCollection(),
    revision: 1,
  });
  assert.equal(reset.status, 200);
  assert.deepEqual(
    (await api(admin, organizations[0])).body.collection,
    defaultAiPromptCollection(),
  );
  await sql`UPDATE organizations SET is_read_only=true WHERE id=${organizations[1]}`;
  assert.equal((await api(admin, organizations[1], input)).status, 403);
  console.log(
    "PASS: authentication, admin-only edits, shared organization templates, tenant isolation, optimistic concurrency, validation, server placeholder rendering, selection, rejected stale templates before billing, reset persistence, read-only organization protection.",
  );
} finally {
  for (const id of users) await sql`DELETE FROM users WHERE id=${id}`;
  for (const id of organizations)
    await sql`DELETE FROM organizations WHERE id=${id}`;
  await sql.end();
  await globalThis.inventorySql?.end();
}
