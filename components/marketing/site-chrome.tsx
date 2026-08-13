import Link from "next/link";
import { Boxes, Container, Github } from "lucide-react";

import {
  DesktopMarketingNavigation,
  MobileMarketingNavigation,
} from "@/components/marketing/marketing-navigation";
import { ThemeToggle } from "@/components/theme-toggle";

const githubUrl = "https://github.com/Utzel-Butzel/inventory";

export function OpenInventoryBrand({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link
      href="/"
      className={`group inline-flex items-center gap-2.5 rounded-xl ${
        inverse ? "text-white" : "text-foreground"
      }`}
      aria-label="Open Inventory Startseite"
    >
      <span className="grid size-9 place-items-center rounded-xl bg-brand-solid text-on-brand shadow-[0_7px_20px_rgba(102,92,255,0.24)] transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-[1.04]">
        <Boxes className="size-[19px]" strokeWidth={2.2} aria-hidden="true" />
      </span>
      <span className="text-[15px] font-semibold tracking-[-0.025em] sm:text-base">
        Open Inventory
      </span>
    </Link>
  );
}

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[70px] max-w-[1240px] items-center justify-between px-5 sm:px-8">
        <OpenInventoryBrand />

        <DesktopMarketingNavigation />

        <div className="hidden items-center gap-2 xl:flex">
          <ThemeToggle />
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-[13px] font-semibold text-foreground transition hover:bg-surface-muted"
          >
            <Github className="size-4" aria-hidden="true" />
            GitHub
          </a>
          <Link
            href="/docs#docker"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-strong px-4 text-[13px] font-semibold text-on-strong shadow-sm transition hover:-translate-y-0.5 hover:opacity-90"
          >
            <Container className="size-3.5" aria-hidden="true" />
            Mit Docker starten
          </Link>
        </div>

        <div className="flex items-center gap-2 xl:hidden">
          <ThemeToggle className="size-10" />
          <MobileMarketingNavigation githubUrl={githubUrl} />
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#111216] text-white">
      <div className="mx-auto max-w-[1240px] px-5 py-12 sm:px-8 sm:py-16">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <OpenInventoryBrand inverse />
            <p className="mt-4 max-w-sm text-sm leading-6 text-white/50">
              Inventarisieren in Sekunden statt Stunden. Offen, selbst hostbar
              und unter der MIT-Lizenz veröffentlicht.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">
              <span>MIT Open Source</span>
              <span aria-hidden="true">·</span>
              <span>Web + iOS</span>
              <span aria-hidden="true">·</span>
              <span>Self-hosted</span>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">Produkt</p>
            <div className="mt-4 grid gap-3 text-sm text-white/65">
              <Link href="/features" className="w-fit hover:text-white">Funktionen</Link>
              <Link href="/ios" className="w-fit hover:text-white">iOS App</Link>
              <Link href="/open-source" className="w-fit hover:text-white">Open Source</Link>
              <Link href="/docs" className="w-fit hover:text-white">Dokumentation</Link>
              <Link href="/api-docs" className="w-fit hover:text-white">API-Referenz</Link>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">Use Cases</p>
            <div className="mt-4 grid gap-3 text-sm text-white/65">
              <Link href="/use-cases/makerspace" className="w-fit hover:text-white">Makerspace</Link>
              <Link href="/use-cases/familie" className="w-fit hover:text-white">Familie</Link>
              <Link href="/use-cases/startup" className="w-fit hover:text-white">Startup</Link>
              <Link href="/use-cases/verein" className="w-fit hover:text-white">Verein & Verleih</Link>
              <Link href="/use-cases/sammlung" className="w-fit hover:text-white">Sammlung</Link>
              <Link href="/use-cases/schule" className="w-fit hover:text-white">Schule</Link>
              <Link href="/use-cases/handwerk" className="w-fit hover:text-white">Handwerk</Link>
              <Link href="/use-cases/labor" className="w-fit hover:text-white">Labor</Link>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">Projekt</p>
            <div className="mt-4 grid gap-3 text-sm text-white/65">
              <a href={githubUrl} target="_blank" rel="noreferrer" className="w-fit hover:text-white">GitHub</a>
              <a href={`${githubUrl}/issues`} target="_blank" rel="noreferrer" className="w-fit hover:text-white">Issues</a>
              <a href={`${githubUrl}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className="w-fit hover:text-white">MIT-Lizenz</a>
              <Link href="/blog" className="w-fit hover:text-white">Blog</Link>
              <Link href="/login" className="w-fit hover:text-white">Web-App öffnen</Link>
              <Link href="/impressum" className="w-fit hover:text-white">Impressum</Link>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs text-white/55 sm:flex-row sm:items-center sm:justify-between">
          <p>Open Inventory · MIT-Lizenz</p>
          <p>Dein Inventar. Deine Infrastruktur. Dein Code.</p>
        </div>
      </div>
    </footer>
  );
}
