import "server-only";

import { spawn } from "node:child_process";
import { access, mkdir, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { bulk3dDeadlineMs, bulk3dLifetimeMs, bulk3dStateSchema, type Bulk3dInput } from "@/lib/inventory-bulk-3d";

// Keep private jobs and the separately provisioned Python environment outside
// the source tree; bundlers must not walk its executable symlinks or weights.
const root = () => path.resolve(process.env.BULK_3D_DATA_PATH || path.join(homedir(), ".local/share/open-inventory/bulk-3d"));
export function bulk3dRuntime() {
  const base = root();
  return {
    python: process.env.BULK_3D_PYTHON || path.join(base, "runtime/bin/python"),
    source: process.env.BULK_3D_SOURCE_PATH || path.join(base, "map-anything"),
    weights: process.env.BULK_3D_WEIGHTS_PATH || path.join(base, "weights/model.safetensors"),
    config: process.env.BULK_3D_MODEL_CONFIG_PATH || path.join(base, "weights/config.json"),
    runner: path.join(process.cwd(), "services/bulk-3d/run_job.py"),
  };
}
export async function bulk3dAvailable() {
  const r = bulk3dRuntime();
  if (process.env.BULK_3D_ENABLED !== "true") return false;
  try {
    await Promise.all([r.python, r.weights, r.config, r.runner, path.join(r.source, "mapanything/models/__init__.py")].map((p) => access(p)));
    return true;
  } catch { return false; }
}
const jobIdSchema = z.string().uuid();
function directory(id: string) { return path.join(root(), "jobs", jobIdSchema.parse(id)); }
const metadataSchema = z.object({ organizationId: z.string(), actorHash: z.string(), resourceId: z.string().uuid(), createdAt: z.number(), expiresAt: z.number() });
export type Bulk3dJobOwner = Pick<z.infer<typeof metadataSchema>, "organizationId" | "actorHash" | "resourceId">;

export async function readBulk3dJob(id: string) {
  if (!jobIdSchema.safeParse(id).success) return null;
  try { return metadataSchema.parse(JSON.parse(await readFile(path.join(directory(id), "owner.json"), "utf8"))); }
  catch { return null; }
}
export async function readBulk3dState(id: string, createdAt: number) {
  let state;
  try { state = bulk3dStateSchema.parse(JSON.parse(await readFile(path.join(directory(id), "state.json"), "utf8"))); }
  catch { state = { status: "queued" as const }; }
  if (!["completed", "failed"].includes(state.status) && Date.now() - createdAt > bulk3dDeadlineMs + 30_000) {
    return { status: "failed" as const, code: "timeout" as const };
  }
  return state;
}
export async function readBulk3dModel(id: string) {
  const file = path.join(directory(id), "model.glb");
  if ((await stat(file)).size > 64 * 1024 * 1024) throw new Error("Model is too large.");
  const bytes = await readFile(file);
  if (bytes.subarray(0, 4).toString() !== "glTF") throw new Error("Invalid model.");
  return bytes;
}
export async function cleanupBulk3dJobs() {
  const jobs = path.join(root(), "jobs");
  const entries = await readdir(jobs).catch(() => []);
  for (const id of entries) {
    if (!jobIdSchema.safeParse(id).success) continue;
    const metadata = await readBulk3dJob(id);
    if (metadata && metadata.expiresAt < Date.now()) await rm(directory(id), { recursive: true, force: true });
  }
}

export async function startBulk3dJob(id: string, owner: Bulk3dJobOwner, input: Bulk3dInput, images: Buffer[]) {
  await cleanupBulk3dJobs();
  const dir = directory(id);
  // The durable AI operation ID is also the job ID. A reclaimed POST cannot
  // launch duplicate work after an ambiguous response or a server restart.
  const existing = await readBulk3dJob(id);
  if (existing) {
    if (existing.organizationId !== owner.organizationId || existing.actorHash !== owner.actorHash || existing.resourceId !== owner.resourceId) throw new Error("Job owner mismatch.");
    return { jobId: id, expiresAt: new Date(existing.expiresAt).toISOString() };
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const createdAt = Date.now(), expiresAt = createdAt + bulk3dLifetimeMs;
  const r = bulk3dRuntime();
  try {
    for (let i = 0; i < images.length; i++) await writeFile(path.join(dir, `image-${i}.jpg`), images[i], { mode: 0o600 });
    await writeFile(path.join(dir, "request.json"), JSON.stringify({ ...input, imageCount: images.length, runtime: r, deadline: createdAt + bulk3dDeadlineMs }), { mode: 0o600 });
    await writeFile(path.join(dir, "state.json"), JSON.stringify({ status: "queued" }), { mode: 0o600 });
    await writeFile(path.join(dir, "owner.json"), JSON.stringify({ ...owner, createdAt, expiresAt }), { mode: 0o600, flag: "wx" });
    const log = await open(path.join(dir, "worker.log"), "a", 0o600);
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(r.python, [r.runner, dir, path.join(root(), "gpu.lock")], {
          detached: true, stdio: ["ignore", log.fd, log.fd],
          env: { ...process.env, PYTORCH_ENABLE_MPS_FALLBACK: "1", PYTHONUNBUFFERED: "1" },
        });
        child.once("error", reject);
        child.once("spawn", () => { child.unref(); resolve(); });
      });
    } finally { await log.close(); }
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  return { jobId: id, expiresAt: new Date(expiresAt).toISOString() };
}
