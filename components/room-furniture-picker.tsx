"use client";
import Image from "next/image";
import { useT } from "next-i18next/client";
import {
  roomFurnitureCatalog,
  roomFurnitureCategory,
  roomFurnitureVariants,
  type RoomFurnitureVariant,
} from "@/lib/room-furniture-catalog";

export function RoomFurniturePicker({
  category,
  value,
  onChange,
}: {
  category: string;
  value: RoomFurnitureVariant | null;
  onChange: (value: RoomFurnitureVariant | null) => void;
}) {
  const { t } = useT("spatial");
  const related = roomFurnitureVariants.filter(
    (variant) =>
      roomFurnitureCatalog[variant].category ===
      roomFurnitureCategory(category),
  );
  return (
    <div className="space-y-2">
      <label className="block text-xs text-muted">
        {t("editor.model")}
        <select
          className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-foreground"
          value={value ?? ""}
          onChange={(event) =>
            onChange(
              (event.target.value || null) as RoomFurnitureVariant | null,
            )
          }
        >
          <option value="">{t("editor.original")}</option>
          {roomFurnitureVariants.map((variant) => (
            <option key={variant} value={variant}>
              {t(`editor.variants.${variant}`)}
            </option>
          ))}
        </select>
      </label>
      {related.length ? (
        <details
          open
          className="rounded-lg border border-border bg-surface-muted p-2"
        >
          <summary className="cursor-pointer text-xs font-medium text-muted">
            {t("editor.relatedModels")}
          </summary>
          <div
            className="mt-2 grid grid-cols-3 gap-1.5"
            role="group"
            aria-label={t("editor.relatedModels")}
          >
            {related.map((variant) => (
              <button
                key={variant}
                type="button"
                aria-pressed={value === variant}
                onClick={() => onChange(variant)}
                className={`rounded-lg border p-1 text-[10px] leading-tight ${value === variant ? "border-brand bg-brand-soft text-brand-strong" : "border-border bg-surface text-muted hover:border-brand"}`}
              >
                <Image
                  src={`/models/room-furniture/v2/${variant}.png`}
                  alt=""
                  width={96}
                  height={96}
                  unoptimized
                  className="aspect-square w-full object-contain"
                />
                <span>{t(`editor.variants.${variant}`)}</span>
              </button>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
