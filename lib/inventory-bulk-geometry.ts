import {
  bulkCountMethodVersion,
  bulkCountResponseSchema,
  bulkGeometrySchema,
  bulkStrategies,
  type BulkCountInput,
  type BulkGeometry,
  type BulkStrategy,
} from "@/lib/inventory-bulk-count";

export function calculateBulkGeometry(raw: BulkGeometry, imageCount: number, strategy: BulkStrategy = "layers") {
  const observation = bulkGeometrySchema.parse(raw);
  if (observation.views.length !== imageCount || new Set(observation.views.map((view) => view.image)).size !== imageCount
    || observation.views.some((view) => view.image > imageCount)) throw new Error("Missing or repeated view evidence.");
  if (observation.status !== "estimated") {
    if (observation.factorA || observation.factorB || observation.volumeGeometry) throw new Error("Unexpected factors without an estimate.");
    if (observation.status === "empty" && (observation.visibleMinimum !== 0 || observation.depthEvidence !== "observed")) {
      throw new Error("An empty result requires a visible empty interior.");
    }
    return observation.status === "empty" ? { count: 0, lowerBound: 0, upperBound: 0 } : null;
  }
  if (observation.depthEvidence === "unconstrained") return null;
  const { factorA: a, factorB: b, volumeGeometry: volume } = observation;
  if (strategy === "layers" ? (!a || !b || volume) : (!volume || a || b)) throw new Error("Missing or mixed geometry methods.");
  const factors = strategy === "layers" ? [a!, b!] : Object.values(volume!);
  for (const factor of factors) {
    if (factor.low > factor.best || factor.best > factor.high) throw new Error("Reversed geometric bounds.");
  }
  if (volume && (volume.containerVolumeFraction.high > 1 || volume.itemShapeFraction.high > 1 || volume.outerEnvelopePacking.high > 10)) {
    throw new Error("Invalid shape fractions.");
  }
  const product = (bound: "low" | "best" | "high") => {
    if (!volume) return a![bound] * b![bound];
    const numerator = [volume.lengthInItemLengths, volume.widthInItemWidths, volume.depthInItemHeights, volume.containerVolumeFraction, volume.outerEnvelopePacking]
      .reduce((value, factor) => value * factor[bound], 1);
    // Division reverses bounds: the smallest item shape permits the most pieces.
    return numerator / volume.itemShapeFraction[bound === "low" ? "high" : bound === "high" ? "low" : "best"];
  };
  const best = product("best"), low = product("low"), high = product("high");
  if (best < observation.visibleMinimum || high > 1_000_000 || low === high) {
    throw new Error("Contradictory geometric estimate.");
  }
  return {
    count: Math.max(1, Math.round(best)),
    lowerBound: Math.max(observation.visibleMinimum, Math.floor(low)),
    upperBound: Math.ceil(high),
  };
}

// The two calls share a model and photographs, so they are not statistically
// independent. Retain the full envelope of both scenarios, never their intersection.
export function combineBulkGeometry(options: {
  observations: [BulkGeometry, BulkGeometry]; imageCount: number; language: BulkCountInput["language"]; model: string;
}) {
  const de = options.language === "de";
  let invalidGeometry = false;
  const methods = options.observations.map((observation, index) => {
    let estimate = null;
    try { estimate = calculateBulkGeometry(observation, options.imageCount, bulkStrategies[index]); }
    catch { invalidGeometry = true; }
    return { strategy: bulkStrategies[index], observation, estimate };
  });
  const [a, b] = methods.map((method) => method.estimate);
  const empty = a?.count === 0 && b?.count === 0;
  // A factor-of-two disagreement is a product guardrail, not an accuracy claim.
  const visibleMinimum = Math.max(...options.observations.map((observation) => observation.visibleMinimum));
  const incompatible = a && b && !empty && (Math.min(a.count, b.count) < visibleMinimum || Math.min(a.count, b.count) === 0 || Math.max(a.count, b.count) / Math.min(a.count, b.count) > 2);
  const supported = Boolean(a && b && !incompatible);
  const divergent = Boolean(a && b && (a.upperBound < b.lowerBound || b.upperBound < a.lowerBound));
  const estimate = supported && a && b ? {
    count: Math.round((a.count + b.count) / 2),
    lowerBound: Math.max(visibleMinimum, Math.min(a.lowerBound, b.lowerBound)),
    upperBound: Math.max(a.upperBound, b.upperBound),
  } : null;
  const unique = (values: string[], maximum: number) => [...new Set(values)].slice(0, maximum);
  const warnings = unique([
    ...(invalidGeometry ? [de ? "Die geometrischen Angaben sind widersprüchlich oder unvollständig. Daraus lässt sich keine verlässliche Menge berechnen." : "The geometric observations are contradictory or incomplete, so they cannot support a reliable quantity."] : []),
    ...(divergent || incompatible ? [de ? "Schicht- und Volumenschätzung widersprechen sich. Die Fülltiefe ist unsicher." : "Layer and volume estimates disagree. The fill depth is uncertain."] : []),
    ...(methods.some((method) => method.observation.depthEvidence === "inferred") ? [de ? "Der Innenboden ist nicht vollständig sichtbar; die Tiefe bleibt eine Annahme." : "The interior bottom is not fully visible; depth remains an assumption."] : []),
    ...methods.flatMap((method) => method.observation.warnings),
  ], 6);
  const captureAdvice = unique([
    ...(!supported ? [de ? "Ergänze eine schräge Aufnahme, die den Innenboden oder die Tiefe vom Boden bis zur Füllfläche besser erkennen lässt." : "Add an oblique view that better shows the interior bottom or the depth from bottom to fill surface."] : []),
    ...methods.flatMap((method) => method.observation.captureAdvice),
  ], 4);
  return bulkCountResponseSchema.parse({
    method: "bulk_visual", isExact: false, accuracyValidated: false, model: options.model,
    estimate, visibility: !supported ? "unclear" : empty ? "mostly_visible" : "partial_layers",
    explanation: !supported
      ? (de ? "Die beiden geometrischen Ansätze ergeben keine ausreichend übereinstimmende Gesamtmenge." : "The two geometric approaches do not support a sufficiently consistent total.")
      : methods.map((method) => `${method.strategy === "layers" ? (de ? "Schichten" : "Layers") : (de ? "Volumen" : "Volume")}: ${method.observation.explanation}`).join("\n"),
    assumptions: unique(methods.flatMap((method) => method.observation.assumptions), 6),
    warnings, captureAdvice,
    analysis: { version: bulkCountMethodVersion, agreement: !supported ? "insufficient" : empty ? "empty" : divergent ? "divergent" : "overlap", methods },
  });
}
