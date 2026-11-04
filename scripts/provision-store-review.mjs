// One-shot provisioning of an isolated, writable store-review workspace.
// Run inside the existing application container with DATABASE_URL configured.
// Credentials arrive over stdin; nothing secret is printed or committed.
import { createHash } from "node:crypto";
import { readFile, mkdir, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { hash } from "bcryptjs";
import {
  DEMO_INVENTORY_TYPES, DEMO_RELATION_TYPES, DEMO_RESOURCES,
  DEMO_RELATIONS, DEMO_MEDIA,
} from "./demo-seed-manifest.mjs";

const organizationId = "a55e0000-0000-4000-8000-000000000001";
const userId = "a55e0000-0000-4000-8000-000000000002";
const slug = "store-review";
const actor = "store-review-provision";
const email = "store-review@inventory.invalid";
const remap = id => {
  if (!/^d3e00000-0000-4000-8000-[0-9a-f]{12}$/.test(id)) throw Error("Unexpected demo ID");
  return id.replace(/^d3e00000/, "a55e0000");
};
const dryRun = process.argv.includes("--dry-run");
if (process.argv.slice(2).some(arg => arg !== "--dry-run")) throw Error("Unknown argument");
if (!process.env.DATABASE_URL) throw Error("DATABASE_URL must explicitly identify the target database");
if (process.env.STORAGE_PROVIDER && process.env.STORAGE_PROVIDER !== "local") {
  throw Error("This provisioner requires local media storage");
}
let input = "";
for await (const chunk of process.stdin) input += chunk;
const credentials = JSON.parse(input);
if (!/^[A-Za-z0-9_-]{32,80}$/.test(credentials.password ?? "") ||
    !/^inv_[A-Za-z0-9_-]{43,100}$/.test(credentials.token ?? "")) {
  throw Error("Provide a random review password and token via stdin");
}
const passwordHash = await hash(credentials.password, 12);
const tokenHash = createHash("sha256").update(credentials.token).digest("hex");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const storageRoot = path.resolve(process.env.STORAGE_LOCAL_PATH || "data/uploads");
const mediaDirectory = path.join(storageRoot, "store-review");
let createdMediaDirectory = false;
const rollback = new Error("review dry-run rollback");
try {
  await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(4457366843)`;
    const existing = await tx`SELECT id FROM organizations WHERE id=${organizationId} OR slug=${slug}`;
    const existingUsers = await tx`SELECT id FROM users WHERE id=${userId} OR email=${email}`;
    if (existing.length || existingUsers.length) throw Error("Review workspace or account already exists; refusing to overwrite it");
    await tx`INSERT INTO organizations (id,name,slug,is_read_only,created_by)
      VALUES (${organizationId},'Open Inventory · Store Review',${slug},false,${actor})`;
    // Organization-local administrator: no super-admin email and no other memberships.
    // Use immutable application permission names, never copy another tenant's roles.
    const permissions = [
      "inventory.read","inventory.create","inventory.update","inventory.delete","inventory.import","inventory.export",
      "contacts.read","contacts.manage","stock.read","stock.manage","assignments.read","assignments.manage",
      "counts.read","counts.manage","spatial.read","spatial.manage","orders.read","orders.manage",
      "requests.read","requests.create","requests.manage","workflows.read","workflows.manage","labels.read","labels.manage",
      "ai.analyze","ai.research","ai.recognize","ai.count","ai.images","ai.translate","ai.rooms",
      "settings.inventory-types.manage","settings.custom-fields.manage","settings.languages.manage","roles.manage",
    ];
    await tx`INSERT INTO access_roles (organization_id,key,name,description,permissions,is_system,created_by)
      VALUES (${organizationId},'store-review','Store Review','Native app review using synthetic inventory only',${permissions},false,${actor})`;
    await tx`INSERT INTO users (id,email,name,password_hash,role,is_active,created_by)
      VALUES (${userId},${email},'Store Reviewer',${passwordHash},'editor',true,${actor})`;
    await tx`INSERT INTO organization_memberships (organization_id,user_id,role_key,is_active,created_by)
      VALUES (${organizationId},${userId},'store-review',true,${actor})`;
    await tx`INSERT INTO api_tokens (organization_id,name,prefix,token_hash,scopes,user_id,user_session_version,created_by)
      VALUES (${organizationId},'Apple and Google app review',${credentials.token.slice(0,12)},${tokenHash},${['read','write','ai']},${userId},1,${actor})`;
    for (const t of DEMO_INVENTORY_TYPES) {
      await tx`INSERT INTO inventory_type_definitions
        (organization_id,key,label,description,color,icon,can_contain,spatial_containment,position,is_system,created_by)
        VALUES (${organizationId},${t.key},${t.label},${t.description},${t.color},${t.icon},${t.canContain},${t.spatialContainment},${t.position},true,${actor})`;
    }
    for (const t of DEMO_RELATION_TYPES) {
      await tx`INSERT INTO relation_type_definitions
        (organization_id,key,label,inverse_label,description,allow_manual,spatial,position,is_system,created_by)
        VALUES (${organizationId},${t.key},${t.label},${t.inverseLabel},${t.description},${t.allowManual},${t.spatial},${t.position},true,${actor})`;
    }
    await tx`INSERT INTO translation_languages (organization_id,code,label,is_default,auto_translate,instructions,position,created_by)
      VALUES (${organizationId},'de','Deutsch',true,false,'',0,${actor})`;
    for (const r of DEMO_RESOURCES) {
      await tx`INSERT INTO resources
        (organization_id,id,name,description,type,status,sku,quantity,location,barcode,value_cents,currency,priority,tags,categories,custom_fields,notes,created_by)
        VALUES (${organizationId},${remap(r.id)},${r.name},${r.description},${r.type},${r.status},${r.sku},${r.quantity},${r.location},${r.barcode},${r.valueCents},'EUR',${r.priority},${r.tags},${tx.json(r.categories)},${tx.json(r.customFields)},${r.notes},${actor})`;
    }
    for (const r of DEMO_RELATIONS) {
      await tx`INSERT INTO resource_relations
        (organization_id,id,source_resource_id,target_resource_id,relation_type_key,origin,created_by)
        VALUES (${organizationId},${remap(r.id)},${remap(r.sourceResourceId)},${remap(r.targetResourceId)},${r.relationTypeKey},'manual',${actor})`;
    }
    if (!dryRun) {
      await mkdir(mediaDirectory); // No recursive overwrite of an existing review directory.
      createdMediaDirectory = true;
    }
    for (const m of DEMO_MEDIA) {
      if (path.basename(m.filename) !== m.filename) throw Error("Invalid media filename");
      const source = new URL(`../demo/assets/${m.filename}`, import.meta.url);
      const bytes = await readFile(source);
      if (createHash("sha256").update(bytes).digest("hex") !== m.sha256) throw Error("Demo media checksum mismatch");
      if (!dryRun) await copyFile(source, path.join(mediaDirectory,m.filename));
      const key = `store-review/${m.filename}`;
      await tx`INSERT INTO media
        (organization_id,id,resource_id,storage_key,url,name,mime_type,kind,size,width,height,position,alt_text,source)
        VALUES (${organizationId},${remap(m.id)},${remap(m.resourceId)},${key},${`/api/files/${key}`},${m.filename},'image/webp','image',${bytes.length},${m.width},${m.height},${m.position},${m.altText},'demo-imagegen')`;
    }
    const memberships = await tx`SELECT organization_id FROM organization_memberships WHERE user_id=${userId}`;
    if (memberships.length !== 1 || memberships[0].organization_id !== organizationId) throw Error("Review isolation check failed");
    if (dryRun) throw rollback;
  });
  console.log(JSON.stringify({ provisioned: true, organizationId, slug, email, resources: DEMO_RESOURCES.length, media: DEMO_MEDIA.length }));
} catch (error) {
  if (createdMediaDirectory) await rm(mediaDirectory,{recursive:true});
  if (error === rollback) console.log("Dry-run passed; all database changes rolled back, no media written.");
  else throw error;
} finally {
  await sql.end();
}
