"use client";
import { useState } from "react";
import { useT } from "next-i18next/client";
import { Plus } from "lucide-react";
export function RoomCreateButton({
  onCreated,
}: {
  onCreated: (scanId: string) => Promise<void>;
}) {
  const { t } = useT("spatial");
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  return (
    <div className="relative text-left">
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-semibold text-foreground"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Plus className="size-4" />
        {t("editor.add")}
      </button>
      {open ? (
        <form
          className="fixed inset-x-4 top-24 z-40 mx-auto max-w-72 space-y-3 rounded-xl border border-border bg-surface p-4 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-72"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            setBusy(true);
            setError(false);
            try {
              const response = await fetch("/api/v1/room-scans/manual", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  name: data.get("name"),
                  width: Number(data.get("width")),
                  depth: Number(data.get("depth")),
                  height: Number(data.get("height")),
                }),
              });
              if (!response.ok) throw new Error();
              const result = await response.json();
              await onCreated(result.scanId);
              setOpen(false);
            } catch {
              setError(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="block text-xs text-muted">
            {t("editor.roomName")}
            <input
              name="name"
              required
              maxLength={240}
              className="mt-1 w-full rounded-lg border border-border bg-surface p-2 text-foreground"
            />
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["width", "depth", "height"] as const).map((key) => (
              <label key={key} className="text-xs text-muted">
                {t(`editor.${key}`)}
                <input
                  name={key}
                  type="number"
                  required
                  min={key === "height" ? 1.8 : 0.8}
                  max={key === "height" ? 10 : 50}
                  step={0.1}
                  defaultValue={key === "height" ? 2.6 : 4}
                  className="mt-1 w-full rounded-lg border border-border bg-surface p-2 text-foreground"
                />
              </label>
            ))}
          </div>
          <button
            disabled={busy}
            className="w-full rounded-lg bg-brand-solid p-2 text-xs font-semibold text-on-brand disabled:opacity-50"
          >
            {t("editor.add")}
          </button>
          {error ? (
            <p role="alert" className="text-xs text-danger">
              {t("editor.errors.edit-failed")}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
