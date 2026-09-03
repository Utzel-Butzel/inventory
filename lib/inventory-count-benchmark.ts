import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

const inventoryCountBenchmarkSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("user-provided"),
      permission: z.string().trim().min(1).max(500),
      attribution: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      kind: z.literal("internet"),
      pageUrl: z.string().url().max(4_096),
      license: z.string().trim().min(1).max(240),
      attribution: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      kind: z.literal("generated"),
      generator: z.string().trim().min(1).max(240),
      promptPath: z.string().trim().min(1).max(500),
      attribution: z.string().trim().min(1).max(500),
    })
    .strict(),
]);

export const inventoryCountBenchmarkCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    imagePath: z.string().trim().min(1).max(500),
    imageSha256: sha256Schema,
    itemHint: z.string().trim().min(1).max(240),
    expectedCount: z.number().int().min(0).max(1_000_000),
    allowedAbsoluteError: z.number().int().min(0).max(1_000_000).default(0),
    source: inventoryCountBenchmarkSourceSchema,
  })
  .strict();

export const inventoryCountBenchmarkManifestSchema = z
  .object({
    version: z.literal(1),
    cases: z.array(inventoryCountBenchmarkCaseSchema).min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const seenIds = new Set<string>();
    for (const [index, benchmarkCase] of manifest.cases.entries()) {
      if (seenIds.has(benchmarkCase.id)) {
        context.addIssue({
          code: "custom",
          path: ["cases", index, "id"],
          message: `Duplicate benchmark case id: ${benchmarkCase.id}`,
        });
      }
      seenIds.add(benchmarkCase.id);
    }
  });

export type InventoryCountBenchmarkCase = z.infer<
  typeof inventoryCountBenchmarkCaseSchema
>;

export type InventoryCountBenchmarkObservation = {
  expectedCount: number;
  allowedAbsoluteError: number;
  actualCount: number | null;
};

export function evaluateInventoryCountBenchmark(
  observation: InventoryCountBenchmarkObservation,
) {
  if (observation.actualCount === null) {
    return {
      absoluteError: null,
      exact: false,
      withinTolerance: false,
    };
  }
  const absoluteError = Math.abs(
    observation.actualCount - observation.expectedCount,
  );
  return {
    absoluteError,
    exact: absoluteError === 0,
    withinTolerance: absoluteError <= observation.allowedAbsoluteError,
  };
}

export function summarizeInventoryCountBenchmark(
  observations: readonly InventoryCountBenchmarkObservation[],
) {
  const evaluations = observations.map(evaluateInventoryCountBenchmark);
  const completed = evaluations.filter(
    (evaluation) => evaluation.absoluteError !== null,
  );
  const totalAbsoluteError = completed.reduce(
    (sum, evaluation) => sum + (evaluation.absoluteError ?? 0),
    0,
  );
  return {
    runs: observations.length,
    completed: completed.length,
    failed: observations.length - completed.length,
    exactMatches: completed.filter((evaluation) => evaluation.exact).length,
    withinTolerance: completed.filter((evaluation) => evaluation.withinTolerance)
      .length,
    meanAbsoluteError: completed.length
      ? totalAbsoluteError / completed.length
      : null,
  };
}
