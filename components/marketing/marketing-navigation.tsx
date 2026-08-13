"use client";

import Link from "next/link";
import {
  Archive,
  ArrowRight,
  Camera,
  ChevronDown,
  Container,
  FlaskConical,
  Github,
  Hammer,
  House,
  MapPinned,
  Menu,
  PackageCheck,
  QrCode,
  Rocket,
  School,
  ShieldCheck,
  Tags,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

type DropdownKey = "features" | "use-cases";

type DropdownItem = {
  label: string;
  href: string;
  description: string;
  icon: LucideIcon;
};

const featureItems: DropdownItem[] = [
  {
    label: "Schnellerfassung & KI",
    href: "/features/erfassen",
    description: "Per Foto erfassen und Vorschläge prüfen.",
    icon: Camera,
  },
  {
    label: "Inventar strukturieren",
    href: "/features/strukturieren",
    description: "Typen, Felder und Beziehungen abbilden.",
    icon: Tags,
  },
  {
    label: "Bestand & Ausleihen",
    href: "/features/bestand-ausleihe",
    description: "Mengen, Geräte und Bewegungen verfolgen.",
    icon: PackageCheck,
  },
  {
    label: "Labels, Scans & API",
    href: "/features/labels-api",
    description: "QR-Codes, Barcodes und Integrationen nutzen.",
    icon: QrCode,
  },
  {
    label: "Orte & 3D-Räume",
    href: "/features/orte-raeume",
    description: "Karten, Räume und Fundorte verbinden.",
    icon: MapPinned,
  },
  {
    label: "Betrieb & Sicherheit",
    href: "/features/betrieb-sicherheit",
    description: "Self-hosting, Rollen und Datenkontrolle.",
    icon: ShieldCheck,
  },
];

const useCaseItems: DropdownItem[] = [
  {
    label: "Makerspace",
    href: "/use-cases/makerspace",
    description: "Werkzeuge, Maschinen und Material.",
    icon: Wrench,
  },
  {
    label: "Familie",
    href: "/use-cases/familie",
    description: "Keller, Kisten und geteilte Dinge.",
    icon: House,
  },
  {
    label: "Startup",
    href: "/use-cases/startup",
    description: "Assets für wachsende Teams.",
    icon: Rocket,
  },
  {
    label: "Verein & Verleih",
    href: "/use-cases/verein",
    description: "Material, Ausgabe und Rückgabe.",
    icon: Users,
  },
  {
    label: "Sammlung",
    href: "/use-cases/sammlung",
    description: "Objekte und Herkunft dokumentieren.",
    icon: Archive,
  },
  {
    label: "Schule & Bildung",
    href: "/use-cases/schule",
    description: "Geräte, Lernmittel und Fachräume.",
    icon: School,
  },
  {
    label: "Handwerk",
    href: "/use-cases/handwerk",
    description: "Werkzeug zwischen Lager und Baustelle.",
    icon: Hammer,
  },
  {
    label: "Labor",
    href: "/use-cases/labor",
    description: "Geräte, Probenbedarf und Standorte.",
    icon: FlaskConical,
  },
];

const directLinks = [
  { label: "iOS App", href: "/ios" },
  { label: "Blog", href: "/blog" },
  { label: "Open Source", href: "/open-source" },
  { label: "Docs", href: "/docs" },
];

function DesktopDropdown({
  dropdownKey,
  label,
  overviewHref,
  overviewLabel,
  overviewDescription,
  items,
  isOpen,
  onToggle,
  onClose,
  buttonRef,
}: {
  dropdownKey: DropdownKey;
  label: string;
  overviewHref: string;
  overviewLabel: string;
  overviewDescription: string;
  items: DropdownItem[];
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const panelId = `marketing-${dropdownKey}-dropdown`;

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onClose();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={onToggle}
        className={`inline-flex h-10 items-center gap-1 rounded-lg px-1.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-border focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
          isOpen ? "text-foreground" : "text-muted hover:text-foreground"
        }`}
      >
        {label}
        <ChevronDown
          className={`size-3.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      <div
        id={panelId}
        hidden={!isOpen}
        className="absolute left-0 top-[calc(100%+8px)] z-50 w-[620px] overflow-hidden rounded-[22px] border border-border bg-surface p-3 shadow-2xl"
      >
        <Link
          href={overviewHref}
          onClick={onClose}
          className="group flex items-center justify-between rounded-2xl bg-surface-muted px-4 py-3.5 transition hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-border"
        >
          <span>
            <span className="block text-sm font-semibold text-foreground">
              {overviewLabel}
            </span>
            <span className="mt-1 block text-[11px] leading-4 text-muted">
              {overviewDescription}
            </span>
          </span>
          <ArrowRight
            className="size-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand"
            aria-hidden="true"
          />
        </Link>

        <div className="mt-2 grid grid-cols-2 gap-1">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className="group flex min-h-[72px] items-start gap-3 rounded-2xl p-3 transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-border"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand transition group-hover:bg-brand-solid group-hover:text-on-brand">
                  <Icon className="size-4" strokeWidth={1.9} aria-hidden="true" />
                </span>
                <span className="min-w-0 pt-0.5">
                  <span className="block text-[13px] font-semibold text-foreground">
                    {item.label}
                  </span>
                  <span className="mt-1 block text-[10px] leading-4 text-muted">
                    {item.description}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>

        <div className="mt-2 flex items-center gap-2 border-t border-border px-3 pb-1 pt-3 text-[10px] font-semibold text-muted">
          <Github className="size-3.5 text-brand" aria-hidden="true" />
          Teil des MIT-lizenzierten Open-Source-Projekts
        </div>
      </div>
    </div>
  );
}

export function DesktopMarketingNavigation() {
  const [openDropdown, setOpenDropdown] = useState<DropdownKey | null>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const featureButtonRef = useRef<HTMLButtonElement>(null);
  const useCaseButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!openDropdown) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!navigationRef.current?.contains(event.target as Node)) {
        setOpenDropdown(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const button =
        openDropdown === "features"
          ? featureButtonRef.current
          : useCaseButtonRef.current;
      setOpenDropdown(null);
      button?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openDropdown]);

  const closeDropdown = () => setOpenDropdown(null);

  return (
    <nav
      ref={navigationRef}
      className="hidden items-center gap-4 xl:flex"
      aria-label="Hauptnavigation"
    >
      <DesktopDropdown
        dropdownKey="features"
        label="Funktionen"
        overviewHref="/features"
        overviewLabel="Alle Funktionen"
        overviewDescription="Den vollständigen Funktionskatalog entdecken."
        items={featureItems}
        isOpen={openDropdown === "features"}
        onToggle={() =>
          setOpenDropdown((current) =>
            current === "features" ? null : "features",
          )
        }
        onClose={closeDropdown}
        buttonRef={featureButtonRef}
      />
      <DesktopDropdown
        dropdownKey="use-cases"
        label="Use Cases"
        overviewHref="/use-cases"
        overviewLabel="Alle Use Cases"
        overviewDescription="Open Inventory in konkreten Arbeitswelten."
        items={useCaseItems}
        isOpen={openDropdown === "use-cases"}
        onToggle={() =>
          setOpenDropdown((current) =>
            current === "use-cases" ? null : "use-cases",
          )
        }
        onClose={closeDropdown}
        buttonRef={useCaseButtonRef}
      />
      {directLinks.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          onClick={closeDropdown}
          className="rounded-lg text-[13px] font-medium text-muted transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-border focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

function MobileAccordion({
  accordionKey,
  label,
  overviewHref,
  overviewLabel,
  items,
  expanded,
  onToggle,
  onNavigate,
}: {
  accordionKey: DropdownKey;
  label: string;
  overviewHref: string;
  overviewLabel: string;
  items: DropdownItem[];
  expanded: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const panelId = `mobile-${accordionKey}-navigation`;

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-semibold text-foreground transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-border"
      >
        {label}
        <ChevronDown
          className={`size-4 text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      <div id={panelId} hidden={!expanded} className="ml-3 border-l border-border pl-2">
        <Link
          href={overviewHref}
          onClick={onNavigate}
          className="flex items-center justify-between rounded-xl px-3 py-2.5 text-[13px] font-semibold text-brand hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-border"
        >
          {overviewLabel}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-muted-strong transition hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-border"
            >
              <Icon className="size-3.5 shrink-0 text-brand" strokeWidth={1.9} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function MobileMarketingNavigation({ githubUrl }: { githubUrl: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedAccordion, setExpandedAccordion] =
    useState<DropdownKey | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const closeNavigation = () => {
    setIsOpen(false);
    setExpandedAccordion(null);
  };

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        closeNavigation();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeNavigation();
      menuButtonRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={menuButtonRef}
        type="button"
        aria-expanded={isOpen}
        aria-controls="mobile-marketing-navigation"
        onClick={() => {
          setIsOpen((current) => !current);
          if (isOpen) setExpandedAccordion(null);
        }}
        className="grid size-10 place-items-center rounded-xl border border-border bg-surface text-foreground shadow-sm transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-border focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {isOpen ? (
          <X className="size-5" aria-hidden="true" />
        ) : (
          <Menu className="size-5" aria-hidden="true" />
        )}
        <span className="sr-only">
          {isOpen ? "Navigation schließen" : "Navigation öffnen"}
        </span>
      </button>

      <nav
        id="mobile-marketing-navigation"
        hidden={!isOpen}
        className="absolute right-0 top-12 max-h-[calc(100dvh-88px)] w-[min(360px,calc(100vw-40px))] overflow-y-auto rounded-2xl border border-border bg-surface p-2 shadow-2xl"
        aria-label="Mobile Navigation"
      >
        <MobileAccordion
          accordionKey="features"
          label="Funktionen"
          overviewHref="/features"
          overviewLabel="Alle Funktionen"
          items={featureItems}
          expanded={expandedAccordion === "features"}
          onToggle={() =>
            setExpandedAccordion((current) =>
              current === "features" ? null : "features",
            )
          }
          onNavigate={closeNavigation}
        />
        <MobileAccordion
          accordionKey="use-cases"
          label="Use Cases"
          overviewHref="/use-cases"
          overviewLabel="Alle Use Cases"
          items={useCaseItems}
          expanded={expandedAccordion === "use-cases"}
          onToggle={() =>
            setExpandedAccordion((current) =>
              current === "use-cases" ? null : "use-cases",
            )
          }
          onNavigate={closeNavigation}
        />

        <div className="mt-1 border-t border-border pt-1">
          {directLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={closeNavigation}
              className="block rounded-xl px-3 py-3 text-sm font-medium text-muted-strong transition hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-border"
            >
              {link.label}
            </Link>
          ))}
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            onClick={closeNavigation}
            className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-medium text-muted-strong transition hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-border"
          >
            GitHub
            <Github className="size-4" aria-hidden="true" />
          </a>
          <Link
            href="/docs#docker"
            onClick={closeNavigation}
            className="mt-1 flex items-center justify-between rounded-xl bg-strong px-3 py-3 text-sm font-semibold text-on-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-border"
          >
            Mit Docker starten
            <Container className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </nav>
    </div>
  );
}
