export function roomVisionModelCapabilities(model: string) {
  const supportsReasoningEffort = /^(?:gpt-5(?:\.|-|$)|o\d)/i.test(model);
  return {
    imageDetail: /^gpt-5\.(?:4|5|6)(?:-|$)/i.test(model)
      ? "original" as const
      : "high" as const,
    reasoning: supportsReasoningEffort
      ? { effort: "medium" as const }
      : null,
  };
}
