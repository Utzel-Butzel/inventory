"use client";

import { useId, useRef } from "react";
import Select from "react-select";
import { useT } from "next-i18next/client";
import { readInventoryTagFilter, writeInventoryTagFilter, inventoryTagConditions, MAX_TAG_FILTER_CONDITIONS, MAX_TAG_FILTER_TAGS, type InventoryTagCondition } from "@/lib/inventory-tag-filter";

export function InventoryTagFilterControl({ value, tags, onChange }: {
  value: string;
  tags: string[];
  onChange: (value: string) => void;
}) {
  const { t } = useT("inventory");
  const conditions = inventoryTagConditions(readInventoryTagFilter(value));
  const totalTags = conditions.reduce((total, condition) => total + condition.tags.length, 0);
  const update = (next: InventoryTagCondition[]) => onChange(writeInventoryTagFilter({ conditions: next }));

  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="text-xs font-semibold text-muted-strong">{t("filters.tagLabel")}</legend>
      {conditions.map((condition, index) => (
        <div key={index} className="min-w-0 space-y-1.5">
          {index > 0 ? <p className="text-xs font-semibold text-muted">{t("filters.tagAnd")}</p> : null}
          <TagConditionControl
            filter={condition}
            tags={tags}
            number={index + 1}
            maxTags={MAX_TAG_FILTER_TAGS - totalTags + condition.tags.length}
            update={(next) => update(conditions.map((entry, position) => position === index ? next : entry))}
          />
          {conditions.length > 1 ? (
            <button type="button" onClick={() => update(conditions.filter((_, position) => position !== index))}
              aria-label={t("filters.tagRemoveCondition", { number: index + 1 })}
              className="text-xs font-medium text-muted hover:text-foreground">
              {t("filters.tagRemove")}
            </button>
          ) : null}
        </div>
      ))}
      <button type="button" disabled={conditions.length >= MAX_TAG_FILTER_CONDITIONS}
        onClick={() => update([...conditions, { operator: "is", tags: [] }])}
        className="h-9 w-full rounded-lg border border-border px-3 text-xs font-semibold text-muted-strong hover:bg-surface-hover disabled:opacity-40">
        {t("filters.tagAddCondition")}
      </button>
      <p className="text-xs text-muted">{t("filters.tagConditionsHint")}</p>
    </fieldset>
  );
}

function TagConditionControl({ filter, tags, number, maxTags, update }: {
  filter: InventoryTagCondition;
  tags: string[];
  number: number;
  maxTags: number;
  update: (filter: InventoryTagCondition) => void;
}) {
  const { t } = useT("inventory");
  const id = useId();
  const menuOpen = useRef(false);

  return (
    <fieldset className="min-w-0 space-y-1.5">
      <legend className="text-xs font-semibold text-muted-strong">{t("filters.tagCondition", { number })}</legend>
      <select
        aria-label={t("filters.tagOperator")}
        value={filter.operator}
        onChange={(event) => update({ ...filter, operator: event.target.value as InventoryTagCondition["operator"] })}
        className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <option value="is">{t("filters.tagOperators.is")}</option>
        <option value="isNot">{t("filters.tagOperators.isNot")}</option>
        <option value="hasNot">{t("filters.tagOperators.hasNot")}</option>
      </select>
      {filter.operator !== "hasNot" ? (
        <Select<{ value: string; label: string }, true>
          instanceId={id}
          inputId={`${id}-tags`}
          aria-label={t("filters.tagLabel")}
          aria-describedby={`${id}-hint`}
          isMulti
          isClearable
          closeMenuOnSelect={false}
          maxMenuHeight={180}
          menuPlacement="auto"
          onMenuOpen={() => { menuOpen.current = true; }}
          onMenuClose={() => { menuOpen.current = false; }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && menuOpen.current) event.stopPropagation();
          }}
          options={tags.map((tag) => ({ value: tag, label: tag }))}
          value={filter.tags.map((tag) => ({ value: tag, label: tag }))}
          onChange={(selected) => update({ ...filter, tags: selected.map((option) => option.value) })}
          isOptionDisabled={() => filter.tags.length >= maxTags}
          placeholder={t("filters.tagPlaceholder")}
          noOptionsMessage={() => t("filters.tagNoOptions")}
          className="text-xs"
          styles={{
            control: (base, state) => ({ ...base, minHeight: 36, borderRadius: 8, backgroundColor: "var(--color-surface)", borderColor: state.isFocused ? "var(--color-focus)" : "var(--color-border)", boxShadow: state.isFocused ? "0 0 0 1px var(--color-focus)" : "none", ":hover": { borderColor: "var(--color-focus)" } }),
            input: (base) => ({ ...base, color: "var(--color-foreground)" }),
            placeholder: (base) => ({ ...base, color: "var(--color-muted)" }),
            // Keep the menu inside the panel without shifting other controls when it closes.
            menu: (base) => ({ ...base, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", boxShadow: "none" }),
            option: (base, state) => ({ ...base, backgroundColor: state.isFocused ? "var(--color-surface-hover)" : "var(--color-surface)", color: "var(--color-foreground)", ":active": { backgroundColor: "var(--color-brand-soft)" } }),
            multiValue: (base) => ({ ...base, backgroundColor: "var(--color-brand-soft)", borderRadius: 4 }),
            multiValueLabel: (base) => ({ ...base, color: "var(--color-brand)" }),
            multiValueRemove: (base) => ({ ...base, color: "var(--color-brand)", ":hover": { backgroundColor: "var(--color-surface-hover)", color: "var(--color-foreground)" } }),
            clearIndicator: (base) => ({ ...base, color: "var(--color-muted)" }),
            dropdownIndicator: (base) => ({ ...base, color: "var(--color-muted)" }),
            indicatorSeparator: (base) => ({ ...base, backgroundColor: "var(--color-border)" }),
          }}
        />
      ) : null}
      <p id={`${id}-hint`} className="text-xs font-normal text-muted">{t(`filters.tagHints.${filter.operator}`)}</p>
    </fieldset>
  );
}
