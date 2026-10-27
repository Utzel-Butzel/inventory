import nextEnv from "@next/env";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { prepareInventoryCountImage } from "../lib/ai.ts";
import { estimateBulkInventoryItems } from "../lib/inventory-bulk-count-ai.ts";
import { bulkCountInputSchema, bulkCountMethodVersion, bulkCountPrompt, bulkStrategies } from "../lib/inventory-bulk-count.ts";

// This explicitly invoked CLI makes two paid provider calls, without the HTTP
// route's tenant/budget middleware. It never books stock. Ground truth is not an
// accepted argument: evaluate the saved result in a separate step.
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { output: { type: "string" }, item: { type: "string" }, model: { type: "string" }, language: { type: "string", default: "de" } },
});
if (!values.output || !values.item || positionals.length < 3 || positionals.length > 5) {
  throw new Error("Usage: npm run qa:bulk-count -- --output NEW_DIRECTORY --item DESCRIPTION [--model MODEL] PHOTO1 PHOTO2 PHOTO3 [PHOTO4 PHOTO5]. Use JPEG/PNG/WebP photos.");
}
nextEnv.loadEnvConfig(process.cwd());
const model = values.model || process.env.OPENAI_BULK_COUNT_MODEL?.trim() || process.env.OPENAI_VISION_MODEL?.trim();
if (!model) throw new Error("Configure a vision model or pass --model.");
const input = bulkCountInputSchema.parse({ itemId: randomUUID(), itemHint: values.item, language: values.language, containerDimensions: null, partDimensions: null });
const output = resolve(values.output);
await mkdir(dirname(output), { recursive: true });
await mkdir(output); // Never overwrite a prior run or select only a successful run.
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const record = {
  startedAt: new Date().toISOString(), model, method: bulkCountMethodVersion, input,
  execution: "Production estimator called directly; two paid provider calls, no tenant route middleware, no stock changes.",
  groundTruthProvidedToEstimator: false,
  prompts: Object.fromEntries(bulkStrategies.map((strategy) => [strategy, bulkCountPrompt(input.language, strategy)])),
  implementation: {}, sources: [],
};
try {
  for (const file of ["lib/inventory-bulk-count.ts", "lib/inventory-bulk-count-ai.ts", "lib/inventory-bulk-geometry.ts"]) {
    record.implementation[file] = sha256(await readFile(new URL(`../${file}`, import.meta.url)));
  }
  const images = [];
  for (const [index, path] of positionals.entries()) {
    const original = await readFile(resolve(path));
    const prepared = await prepareInventoryCountImage(original);
    const bytes = Buffer.from(prepared.dataUrl.split(",")[1], "base64");
    const submittedFile = `view-${index + 1}.jpg`;
    await writeFile(resolve(output, submittedFile), bytes, { flag: "wx" });
    record.sources.push({ path: resolve(path), sourceSha256: sha256(original), submittedFile, submittedSha256: sha256(bytes), width: prepared.width, height: prepared.height });
    images.push(prepared.dataUrl);
  }
  if (new Set(record.sources.map((source) => source.submittedSha256)).size !== images.length) throw new Error("Duplicate photos.");
  await writeFile(resolve(output, "request.json"), JSON.stringify(record, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: "started", model, photos: images.length, output }));
  const result = await estimateBulkInventoryItems({
    input, images, model, idempotencyKey: randomUUID(),
    onObservations: (observations) => writeFile(resolve(output, "observations.json"), JSON.stringify(observations, null, 2), { flag: "wx" }),
  });
  await writeFile(resolve(output, "result.json"), JSON.stringify({ ...record, completedAt: new Date().toISOString(), result }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ output, result }, null, 2));
} catch (error) {
  await writeFile(resolve(output, "failure.json"), JSON.stringify({ ...record, failedAt: new Date().toISOString(), error: { name: error?.name, status: error?.status, message: error?.message } }, null, 2), { flag: "wx" });
  console.error(error?.name, error?.message);
  process.exitCode = 1;
}
