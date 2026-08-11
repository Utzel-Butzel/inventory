"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyInstallCommand({
  command,
  ariaLabel = "Copy command",
}: {
  command: string;
  ariaLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copyCommand}
      className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.065] px-3 text-[11px] font-semibold text-white/65 transition hover:bg-white/10 hover:text-white"
      aria-label={ariaLabel}
    >
      {copied ? (
        <Check className="size-3.5 text-[#83f3c1]" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
