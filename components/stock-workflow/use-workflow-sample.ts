"use client";

import type { TFunction } from "i18next";
import { useState } from "react";

import { fetchJson } from "@/lib/client-types";
import { type ScanCodeType } from "@/lib/scan-code-types";
import { scanRegexFromSelection } from "@/lib/scan-regex";

import { updateDraftExtraction } from "./draft";
import type { WorkflowStepProps } from "./types";

export function useWorkflowSample(
  setDraft: WorkflowStepProps["setDraft"],
  t: TFunction,
) {
  const [sampleScan, setSampleScan] = useState(
    "https://paperlesspaper.de/b?d=epd13-9c139ed7b44c&w=99",
  );
  const [sampleCodeType, setSampleCodeType] = useState<ScanCodeType | null>(
    "qr_code",
  );
  const [sampleSelection, setSampleSelection] = useState({ start: 0, end: 0 });
  const [showExampleScanner, setShowExampleScanner] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const selectedSampleValue = sampleScan.slice(
    sampleSelection.start,
    sampleSelection.end,
  );
  const applySelectionRegex = (fieldUid?: string) => {
    const generated = scanRegexFromSelection(
      sampleScan,
      sampleSelection.start,
      sampleSelection.end,
    );
    if (!generated) {
      setAiError(t("workflows.regexStudio.selectValue"));
      return;
    }
    setDraft((current) =>
      updateDraftExtraction(current, { mode: "regex", ...generated }, fieldUid),
    );
    setAiError(null);
    setAiExplanation(t("workflows.regexStudio.selectionApplied"));
  };

  const generateRegexWithAi = async () => {
    const instruction = aiInstruction.trim();
    if (!selectedSampleValue && !instruction) {
      setAiError(t("workflows.regexStudio.selectOrDescribe"));
      return;
    }
    setAiGenerating(true);
    setAiError(null);
    setAiExplanation(null);
    try {
      const result = await fetchJson<{
        suggestion: {
          pattern: string;
          flags: string;
          group: string;
          explanation: string;
        };
      }>("/api/v1/stock/scan-workflows/extraction-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleCode: sampleScan,
          codeType: sampleCodeType,
          ...(selectedSampleValue ? { desiredValue: selectedSampleValue } : {}),
          ...(instruction ? { instruction } : {}),
        }),
      });
      setDraft((current) => updateDraftExtraction(current, {
        mode: "regex",
        pattern: result.suggestion.pattern,
        flags: result.suggestion.flags,
        group: result.suggestion.group,
      }));
      setAiExplanation(result.suggestion.explanation);
    } catch (error) {
      setAiError(
        error instanceof Error
          ? error.message
          : t("workflows.regexStudio.aiError"),
      );
    } finally {
      setAiGenerating(false);
    }
  };

  return {
    sampleScan,
    setSampleScan,
    sampleCodeType,
    setSampleCodeType,
    setSampleSelection,
    showExampleScanner,
    setShowExampleScanner,
    aiInstruction,
    setAiInstruction,
    aiGenerating,
    aiExplanation,
    aiError,
    selectedSampleValue,
    applySelectionRegex,
    generateRegexWithAi,
  };
}

export type WorkflowSample = ReturnType<typeof useWorkflowSample>;
