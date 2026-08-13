import Link from "next/link";
import {
  ArrowUpRight,
  Boxes,
  Github,
  Menu,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";

const githubUrl = "https://github.com/Utzel-Butzel/inventory";

export function OpenInventoryBrand({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link
      href="/"
      className={`group inline-flex items-center gap-2.5 rounded-xl ${
        inverse ? "text-white" : "text-foreground"
      }`}
      aria-label="Open Inventory home"
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

const navLinks = [
  { label: "AI", href: "/#ai" },
  { label: "Inventory", href: "/#inventory" },
  { label: "App", href: "/#app" },
  { label: "Docker", href: "/#docker" },
  { label: "Docs", href: "/docs" },
  { label: "API", href: "/api-docs" },
];

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[70px] max-w-[1240px] items-center justify-between px-5 sm:px-8">
        <OpenInventoryBrand />

        <nav
          className="hidden items-center gap-7 lg:flex"
          aria-label="Primary navigation"
        >
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg text-[13px] font-medium text-muted transition hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
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
            href="/login"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-strong px-4 text-[13px] font-semibold text-on-strong shadow-sm transition hover:-translate-y-0.5 hover:opacity-90"
          >
            Open workspace
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <ThemeToggle className="size-10" />
          <details className="group relative">
          <summary className="grid size-10 list-none place-items-center rounded-xl border border-border bg-surface text-foreground shadow-sm [&::-webkit-details-marker]:hidden">
            <Menu className="size-5" aria-hidden="true" />
            <span className="sr-only">Open navigation</span>
          </summary>
          <nav
            className="absolute right-0 top-12 flex w-[min(280px,calc(100vw-40px))] flex-col rounded-2xl border border-border bg-surface p-2 shadow-2xl"
            aria-label="Mobile navigation"
          >
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-xl px-3 py-3 text-sm font-medium text-muted-strong hover:bg-surface-muted"
              >
                {link.label}
              </Link>
            ))}
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-medium text-muted-strong hover:bg-surface-muted"
            >
              GitHub
              <Github className="size-4" aria-hidden="true" />
            </a>
            <Link
              href="/login"
              className="mt-1 flex items-center justify-between rounded-xl bg-strong px-3 py-3 text-sm font-semibold text-on-strong"
            >
              Open workspace
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#111216] text-white">
      <div className="mx-auto max-w-[1240px] px-5 py-12 sm:px-8 sm:py-16">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <OpenInventoryBrand inverse />
            <p className="mt-4 max-w-sm text-sm leading-6 text-white/50">
              Take a photo. AI builds the inventory record.
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
              Product
            </p>
            <div className="mt-4 grid gap-3 text-sm text-white/65">
              <Link href="/#ai" className="w-fit hover:text-white">AI features</Link>
              <Link href="/#app" className="w-fit hover:text-white">iOS app</Link>
              <Link href="/#docker" className="w-fit hover:text-white">Docker</Link>
              <Link href="/docs" className="w-fit hover:text-white">Documentation</Link>
              <Link href="/api-docs" className="w-fit hover:text-white">API reference</Link>
            </div>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
              Project
            </p>
            <div className="mt-4 grid gap-3 text-sm text-white/65">
              <a href={githubUrl} target="_blank" rel="noreferrer" className="w-fit hover:text-white">GitHub</a>
              <a href={`${githubUrl}/issues`} target="_blank" rel="noreferrer" className="w-fit hover:text-white">Issues</a>
              <a href={`${githubUrl}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className="w-fit hover:text-white">MIT License</a>
              <Link href="/openapi.yaml" className="w-fit hover:text-white">OpenAPI</Link>
              <Link href="/impressum" className="w-fit hover:text-white">Impressum</Link>
            </div>
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs text-white/55 sm:flex-row sm:items-center sm:justify-between">
          <p>Open Inventory · MIT License</p>
          <p>The modern way to inventory.</p>
        </div>
      </div>
    </footer>
  );
}
