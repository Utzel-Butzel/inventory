"use client";

import { useEffect, useState } from "react";
import { LABEL_SHORTCODE_PATTERN } from "@/lib/label-shortcode-contract";

// Deduplicate mounted previews/copies, but do not retain authorization-sensitive results.
const requests = new Map<string, Promise<string>>();
function requestCode(resourceId: string, stockUnitId: string | null) {
  const key = `${window.location.pathname}:${resourceId}:${stockUnitId ?? ""}`;
  let request = requests.get(key);
  if (!request) {
    request = (async () => {
      const response = await fetch("/api/v1/labels/shortcodes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId, stockUnitId }), signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error("Unable to prepare the label shortcode.");
      const { code } = await response.json();
      if (typeof code !== "string" || !LABEL_SHORTCODE_PATTERN.test(code)) throw new Error("Invalid label shortcode.");
      return code;
    })().finally(() => requests.delete(key));
    requests.set(key, request);
  }
  return request;
}

export function useLabelShortcode(enabled: boolean, resourceId: string, stockUnitId: string | null) {
  const [attempt, setAttempt] = useState(0);
  const key = `${enabled}:${resourceId}:${stockUnitId ?? ""}:${attempt}`;
  const [result, setResult] = useState<{ key: string; code?: string; error?: boolean } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void requestCode(resourceId, stockUnitId).then(
      code => { if (active) setResult({ key, code }); },
      () => { if (active) setResult({ key, error: true }); },
    );
    return () => { active = false; };
  }, [enabled, resourceId, stockUnitId, key]);
  const current = result?.key === key ? result : null;
  return { code: current?.code, error: current?.error ?? false, retry: () => setAttempt(value => value + 1) };
}
