"use client";

import { Check } from "lucide-react";
import { useId, useMemo, useState } from "react";
import Select from "react-select";
import { useT } from "next-i18next/client";

import { LabelRenderer } from "@/components/label-renderer";
import { useLabelLayout } from "@/components/use-label-layout";
import type { LabelSetupDto } from "@/lib/label-setup-contract";
import type { LabelResource } from "@/lib/label-target";
import styles from "./label-printer.module.css";

type TemplateOption = { value: string; label: string; setup: LabelSetupDto };

function TemplateThumbnail({ setup, resource, origin }: {
  setup: LabelSetupDto;
  resource: LabelResource;
  origin: string;
}) {
  // A visual sample must not allocate shortcodes when browsing templates.
  const previewSetup = useMemo(() => ({
    ...setup,
    elements: setup.elements.map(element => element.type === "qr"
      ? { ...element, useShortcode: false } : element),
  }), [setup]);
  const layout = useLabelLayout(previewSetup, resource, origin);
  const pixelsPerMm = 96 / 25.4;
  const width = layout.widthMm * pixelsPerMm;
  const height = layout.heightMm * pixelsPerMm;
  const scale = Math.min(104 / width, 48 / height, 1);

  return (
    <div className={styles.templateThumbnail} aria-hidden="true">
      <div style={{ width: width * scale, height: height * scale }}>
        <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <LabelRenderer setup={previewSetup} resource={resource} origin={origin}
            pixelsPerMm={pixelsPerMm} showImagePlaceholder />
        </div>
      </div>
    </div>
  );
}

export function LabelTemplateSelect({ setups, value, sampleResource, origin, loading, onChange }: {
  setups: LabelSetupDto[];
  value: string;
  sampleResource: LabelResource | null;
  origin: string;
  loading: boolean;
  onChange: (id: string) => void;
}) {
  const { t } = useT("labels");
  const id = useId();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const options = useMemo<TemplateOption[]>(() => setups.map(setup => ({
    value: setup.id, label: `${setup.name} · ${setup.widthMm} × ${setup.heightMm} mm`, setup,
  })), [setups]);
  const resource = useMemo<LabelResource>(() => ({
    ...(sampleResource ?? {
      id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      name: t("designer.sample.name"),
      subtitle: t("designer.sample.subtitle"),
      location: t("designer.sample.location"),
      sku: "TOOL-042", barcode: null, type: "tool", quantity: 3, cover: null,
    }),
    previewOnly: true,
  }), [sampleResource, t]);

  return (
    <Select<TemplateOption>
      instanceId={id}
      inputId={id}
      aria-label={t("setup.label")}
      className="min-w-0 flex-1 basis-52 text-sm"
      value={options.find(option => option.value === value) ?? null}
      options={options}
      onChange={option => { if (option) onChange(option.value); }}
      isDisabled={loading || options.length === 0}
      isLoading={loading}
      isSearchable={false}
      isClearable={false}
      placeholder={t("setup.empty")}
      menuPortalTarget={portalTarget}
      onMenuOpen={() => setPortalTarget(document.body)}
      menuPosition="fixed"
      menuPlacement="auto"
      maxMenuHeight={320}
      formatOptionLabel={(option, { context }) => (
        <div className={styles.templateOption}>
          <TemplateThumbnail setup={option.setup} resource={resource} origin={origin} />
          <div className="min-w-0 flex-1">
            <div className={context === "menu" ? "whitespace-normal break-words font-semibold" : "truncate font-semibold"}
              title={option.setup.name}>{option.setup.name}</div>
            <div className="mt-0.5 text-xs text-muted">{option.setup.widthMm} × {option.setup.heightMm} mm</div>
          </div>
          {context === "menu" && option.value === value
            ? <Check size={17} className="shrink-0 text-brand" aria-hidden="true" /> : null}
        </div>
      )}
      styles={{
        control: (base, state) => ({ ...base, minHeight: 76, borderRadius: 12,
          backgroundColor: state.isDisabled ? "var(--color-surface-subtle)" : "var(--color-surface)",
          borderColor: state.isFocused ? "var(--color-focus)" : "var(--color-border)",
          boxShadow: state.isFocused ? "0 0 0 3px color-mix(in srgb, var(--color-focus) 15%, transparent)" : "none",
          cursor: state.isDisabled ? "default" : "pointer",
          ":hover": { borderColor: state.isFocused ? "var(--color-focus)" : "var(--color-border-strong)" } }),
        valueContainer: base => ({ ...base, padding: "6px 10px" }),
        singleValue: base => ({ ...base, color: "var(--color-foreground)", width: "100%", margin: 0 }),
        placeholder: base => ({ ...base, color: "var(--color-muted)" }),
        indicatorSeparator: () => ({ display: "none" }),
        dropdownIndicator: base => ({ ...base, color: "var(--color-muted)" }),
        menuPortal: base => ({ ...base, zIndex: 50 }),
        menu: base => ({ ...base, borderRadius: 14, overflow: "hidden", fontSize: 14,
          backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", boxShadow: "var(--shadow-lg)" }),
        menuList: base => ({ ...base, padding: 5, overscrollBehaviorY: "contain",
          scrollbarWidth: "thin", scrollbarColor: "var(--color-border-strong) transparent" }),
        option: (base, state) => ({ ...base, padding: "8px", borderRadius: 9, cursor: "pointer",
          backgroundColor: state.isSelected ? "var(--color-brand-soft)" : state.isFocused ? "var(--color-surface-hover)" : "var(--color-surface)",
          color: "var(--color-foreground)", ":active": { backgroundColor: "var(--color-brand-soft)" } }),
      }}
    />
  );
}
