"use client";

import { useId, useRef } from "react";
import Select from "react-select";
import { useT } from "next-i18next/client";
import type { LabelFontFamily } from "@/lib/label-setup-contract";
import { LABEL_FONT_CATEGORIES, LABEL_FONT_CATEGORY, LABEL_FONT_STACKS, LABEL_NAMED_FONTS } from "@/lib/label-typography";

type FontOption = { value: LabelFontFamily; label: string; category: string };

export function LabelFontSelect({ value, onChange }: {
  value: LabelFontFamily;
  onChange: (font: LabelFontFamily) => void;
}) {
  const { t } = useT("labels");
  const id = useId();
  const menuOpen = useRef(false);
  const fonts: FontOption[] = [
    ...LABEL_NAMED_FONTS.map(([value, label]) => ({ value, label, category: t(`designer.fontCategories.${LABEL_FONT_CATEGORY[value]}`) })),
    ...(["sans", "serif", "monospace", "rounded"] as const).map(value => ({ value, label: t(`designer.fontFamilies.${value}`), category: t("designer.fontCategories.system") })),
  ];
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[11px] font-semibold text-muted">{t("designer.fontFamily")}</label>
      <Select<FontOption>
        instanceId={id}
        inputId={id}
        isSearchable
        isClearable={false}
        value={fonts.find(font => font.value === value)}
        options={LABEL_FONT_CATEGORIES.map(category => ({
          label: t(`designer.fontCategories.${category}`),
          options: fonts.filter(font => LABEL_FONT_CATEGORY[font.value] === category),
        }))}
        onChange={option => { if (option) onChange(option.value); }}
        filterOption={({ data }, query) => `${data.label} ${data.category}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())}
        formatOptionLabel={(option) => <span style={{ fontFamily: LABEL_FONT_STACKS[option.value] }}>{option.label}</span>}
        placeholder={t("designer.fontSearch")}
        noOptionsMessage={() => t("designer.fontNoResults")}
        screenReaderStatus={({ count }) => t("designer.fontResultCount", { count })}
        menuPlacement="auto"
        maxMenuHeight={260}
        onMenuOpen={() => { menuOpen.current = true; }}
        onMenuClose={() => { menuOpen.current = false; }}
        onKeyDown={event => { if (event.key === "Escape" && menuOpen.current) event.stopPropagation(); }}
        className="text-xs font-normal"
        styles={{
          control: (base, state) => ({ ...base, minHeight: 36, borderRadius: 8, backgroundColor: "var(--color-surface)", borderColor: state.isFocused ? "var(--color-focus)" : "var(--color-border)", boxShadow: state.isFocused ? "0 0 0 1px var(--color-focus)" : "none" }),
          input: base => ({ ...base, color: "var(--color-foreground)" }),
          singleValue: base => ({ ...base, color: "var(--color-foreground)" }),
          placeholder: base => ({ ...base, color: "var(--color-muted)" }),
          menu: base => ({ ...base, zIndex: 20, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)" }),
          groupHeading: base => ({ ...base, color: "var(--color-muted)" }),
          option: (base, state) => ({ ...base, backgroundColor: state.isSelected ? "var(--color-brand-soft)" : state.isFocused ? "var(--color-surface-hover)" : "var(--color-surface)", color: "var(--color-foreground)", ":active": { backgroundColor: "var(--color-brand-soft)" } }),
          noOptionsMessage: base => ({ ...base, color: "var(--color-muted)" }),
        }}
      />
      <p className="text-[11px] text-muted">{t("designer.fontSearchHint")}</p>
    </div>
  );
}
