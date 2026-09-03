import { createHash } from "node:crypto";
import { accessSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import {
  countDenseRepeatedInventoryItems,
  denseComponentCountModelLabel,
} from "../lib/dense-component-count.ts";
import {
  countInventoryItems,
  getReplicateCountOutcome,
  prepareInventoryCountImage,
} from "../lib/ai.ts";
import {
  evaluateInventoryCountBenchmark,
  inventoryCountBenchmarkManifestSchema,
  summarizeInventoryCountBenchmark,
} from "../lib/inventory-count-benchmark.ts";
import {
  getInventoryCountModelCatalog,
  inventoryCountModelIds,
  isInventoryCountModelId,
} from "../lib/inventory-count-models.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultManifestPath = resolve(
  projectRoot,
  "tests/fixtures/inventory-count/manifest.json",
);

for (const filename of [".env", ".env.local"]) {
  try {
    const path = resolve(projectRoot, filename);
    accessSync(path);
    process.loadEnvFile(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const { values } = parseArgs({
  allowPositionals: false,
  options: {
    manifest: { type: "string" },
    case: { type: "string", multiple: true },
    model: { type: "string", multiple: true },
    "all-models": { type: "boolean", default: false },
    "provider-only": { type: "boolean", default: false },
    output: { type: "string" },
    list: { type: "boolean", default: false },
    "allow-failures": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

function printHelp() {
  console.log(`Inventory photo-count benchmark

Usage:
  npm run qa:count
  npm run qa:count -- --model yolo-world --case user-glue-bottles-9
  npm run qa:count -- --all-models --allow-failures

Options:
  --case <id>          Run one case; repeat to select several cases
  --model <id>         Run one model; repeat to select several models
  --all-models         Run every configured counting model
  --provider-only      Skip the production local dense-component preflight
  --manifest <path>    Use another manifest
  --output <path>      Result directory (default: outputs/inventory-count-benchmark)
  --list               Validate and list cases without calling Replicate
  --allow-failures     Exit successfully even when counts differ or runs fail
  --help, -h           Show this help`);
}

if (values.help) {
  printHelp();
  process.exit(0);
}
if (values["all-models"] && values.model?.length) {
  throw new Error("Use either --all-models or --model, not both.");
}

const manifestPath = resolve(projectRoot, values.manifest ?? defaultManifestPath);
const manifestDirectory = dirname(manifestPath);
const manifest = inventoryCountBenchmarkManifestSchema.parse(
  JSON.parse(await readFile(manifestPath, "utf8")),
);
const requestedCaseIds = new Set(values.case ?? []);
const cases = requestedCaseIds.size
  ? manifest.cases.filter((benchmarkCase) => requestedCaseIds.has(benchmarkCase.id))
  : manifest.cases;
const missingCaseIds = [...requestedCaseIds].filter(
  (id) => !manifest.cases.some((benchmarkCase) => benchmarkCase.id === id),
);
if (missingCaseIds.length) {
  throw new Error(`Unknown benchmark case(s): ${missingCaseIds.join(", ")}`);
}

for (const modelId of values.model ?? []) {
  if (!isInventoryCountModelId(modelId)) {
    throw new Error(
      `Unknown model ${modelId}. Choose one of: ${inventoryCountModelIds.join(", ")}`,
    );
  }
}
const models = values["all-models"]
  ? [...inventoryCountModelIds]
  : values.model?.length
    ? [...new Set(values.model)]
    : [getInventoryCountModelCatalog().defaultModelId];

async function readVerifiedFixture(benchmarkCase) {
  const imagePath = resolve(manifestDirectory, benchmarkCase.imagePath);
  const imageBytes = await readFile(imagePath);
  const actualSha256 = createHash("sha256").update(imageBytes).digest("hex");
  if (actualSha256 !== benchmarkCase.imageSha256) {
    throw new Error(
      `${benchmarkCase.id}: fixture hash mismatch (expected ${benchmarkCase.imageSha256}, got ${actualSha256}).`,
    );
  }
  return { imagePath, imageBytes };
}

const verifiedCases = [];
for (const benchmarkCase of cases) {
  const fixture = await readVerifiedFixture(benchmarkCase);
  verifiedCases.push({ ...benchmarkCase, ...fixture });
}

if (values.list) {
  console.table(
    verifiedCases.map((benchmarkCase) => ({
      id: benchmarkCase.id,
      expected: benchmarkCase.expectedCount,
      tolerance: benchmarkCase.allowedAbsoluteError,
      hint: benchmarkCase.itemHint,
      image: relative(projectRoot, benchmarkCase.imagePath),
      source: benchmarkCase.source.kind,
    })),
  );
  console.log(`Models selected: ${models.join(", ")}`);
  process.exit(0);
}

const outputDirectory = resolve(
  projectRoot,
  values.output ?? "outputs/inventory-count-benchmark",
);
await mkdir(outputDirectory, { recursive: true });

async function completedOutcome(options) {
  const withProviderBackoff = async (operation) => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const retryAfterSeconds = Number(error?.retryAfterSeconds);
        const safeToRetry =
          Number.isFinite(retryAfterSeconds) &&
          retryAfterSeconds > 0 &&
          error?.ambiguousProviderCreate !== true;
        if (!safeToRetry || attempt === 4) throw error;
        const delayMilliseconds = Math.min(30_000, retryAfterSeconds * 1_000);
        console.log(
          `Provider asked for a retry; waiting ${delayMilliseconds / 1_000}s (attempt ${attempt + 1}/4)...`,
        );
        await wait(delayMilliseconds);
      }
    }
    throw new Error("The provider retry loop ended unexpectedly.");
  };

  if (!values["provider-only"]) {
    const localResult = await countDenseRepeatedInventoryItems({
      imageDataUrl: options.imageDataUrl,
      itemHint: options.itemHint,
      language: process.env.AI_OUTPUT_LANGUAGE,
    });
    if (localResult) {
      return {
        kind: "completed",
        result: localResult,
        model: denseComponentCountModelLabel,
      };
    }
  }

  let outcome = await withProviderBackoff(() => countInventoryItems(options));
  while (outcome.kind === "processing") {
    const remainingMilliseconds = Date.parse(outcome.job.expiresAt) - Date.now();
    if (remainingMilliseconds <= 0) {
      throw new Error("The provider job expired before returning a result.");
    }
    await wait(Math.min(2_000, remainingMilliseconds));
    outcome = await withProviderBackoff(() =>
      getReplicateCountOutcome(outcome.job),
    );
  }
  return outcome;
}

async function writeAnnotatedImage({ benchmarkCase, modelId, prepared, result }) {
  const jpegBytes = Buffer.from(prepared.dataUrl.split(",", 2)[1], "base64");
  const markerRadius = Math.max(12, Math.round(Math.min(prepared.width, prepared.height) * 0.018));
  const fontSize = Math.max(14, Math.round(markerRadius * 0.95));
  const markerSvg = result.markers
    .map((marker, index) => {
      const x = Math.round((marker.x / 1_000) * prepared.width);
      const y = Math.round((marker.y / 1_000) * prepared.height);
      return `<circle cx="${x}" cy="${y}" r="${markerRadius}" fill="#22c55ecc" stroke="#ffffff" stroke-width="3"/><text x="${x}" y="${y + Math.round(fontSize * 0.35)}" text-anchor="middle" font-family="sans-serif" font-size="${fontSize}" font-weight="700" fill="#052e16">${index + 1}</text>`;
    })
    .join("");
  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${prepared.width}" height="${prepared.height}">${markerSvg}</svg>`,
  );
  const filename = `${benchmarkCase.id}--${modelId}.jpg`;
  await sharp(jpegBytes)
    .composite([{ input: overlay, left: 0, top: 0 }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(resolve(outputDirectory, filename));
  return filename;
}

const results = [];
for (const benchmarkCase of verifiedCases) {
  const prepared = await prepareInventoryCountImage(benchmarkCase.imageBytes);
  for (const modelId of models) {
    const startedAt = new Date();
    console.log(
      `Counting ${benchmarkCase.id} with ${modelId} (expected ${benchmarkCase.expectedCount})...`,
    );
    try {
      const outcome = await completedOutcome({
        imageDataUrl: prepared.dataUrl,
        imageWidth: prepared.width,
        imageHeight: prepared.height,
        itemHint: benchmarkCase.itemHint,
        modelId,
      });
      const evaluation = evaluateInventoryCountBenchmark({
        expectedCount: benchmarkCase.expectedCount,
        allowedAbsoluteError: benchmarkCase.allowedAbsoluteError,
        actualCount: outcome.result.count,
      });
      const annotatedImage = await writeAnnotatedImage({
        benchmarkCase,
        modelId,
        prepared,
        result: outcome.result,
      });
      results.push({
        caseId: benchmarkCase.id,
        modelId,
        expectedCount: benchmarkCase.expectedCount,
        allowedAbsoluteError: benchmarkCase.allowedAbsoluteError,
        actualCount: outcome.result.count,
        ...evaluation,
        confidence: outcome.result.confidence,
        markers: outcome.result.markers,
        warnings: outcome.result.warnings,
        providerModel: outcome.model,
        durationMilliseconds: Date.now() - startedAt.getTime(),
        annotatedImage,
        error: null,
      });
    } catch (error) {
      results.push({
        caseId: benchmarkCase.id,
        modelId,
        expectedCount: benchmarkCase.expectedCount,
        allowedAbsoluteError: benchmarkCase.allowedAbsoluteError,
        actualCount: null,
        absoluteError: null,
        exact: false,
        withinTolerance: false,
        confidence: null,
        markers: [],
        warnings: [],
        providerModel: null,
        durationMilliseconds: Date.now() - startedAt.getTime(),
        annotatedImage: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

const summary = summarizeInventoryCountBenchmark(results);
const report = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  manifest: relative(projectRoot, manifestPath),
  models,
  summary,
  results,
};
await writeFile(
  resolve(outputDirectory, "report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);

console.table(
  results.map((result) => ({
    case: result.caseId,
    model: result.modelId,
    expected: result.expectedCount,
    actual: result.actualCount ?? "error",
    error: result.absoluteError ?? "-",
    pass: result.withinTolerance ? "yes" : "no",
    confidence:
      typeof result.confidence === "number"
        ? result.confidence.toFixed(3)
        : "-",
    seconds: (result.durationMilliseconds / 1_000).toFixed(1),
  })),
);
console.log(
  `Summary: ${summary.withinTolerance}/${summary.runs} within tolerance; mean absolute error ${summary.meanAbsoluteError ?? "n/a"}.`,
);
console.log(`Report: ${relative(projectRoot, resolve(outputDirectory, "report.json"))}`);

if (
  !values["allow-failures"] &&
  results.some((result) => !result.withinTolerance)
) {
  process.exitCode = 1;
}
