import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Check,
  Container,
  Github,
  Smartphone,
} from "lucide-react";

import {
  MarketingFooter,
  MarketingHeader,
} from "@/components/marketing/site-chrome";

import { featureGroups } from "./features";

const githubUrl = "https://github.com/Utzel-Butzel/inventory";

export const metadata: Metadata = {
  title: { absolute: "Alle Funktionen — Open Inventory" },
  description:
    "Von der Fotoerfassung über Lagerbewegungen und QR-Etiketten bis zur offenen API: alle Funktionen von Open Inventory verständlich erklärt.",
  alternates: { canonical: "/features" },
  openGraph: {
    title: "Alle Funktionen — Open Inventory",
    description:
      "Inventarisieren in Sekunden statt Stunden – mit Fotoerfassung, Lagerverwaltung, iOS-App und offener API.",
    images: ["/og.png"],
  },
};

function InventoryPreview() {
  return (
    <div className="overflow-hidden rounded-[28px] border border-border bg-surface shadow-[0_28px_80px_rgba(24,20,38,0.14)]">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <span className="size-2.5 rounded-full bg-[#ff6a64]" />
        <span className="size-2.5 rounded-full bg-[#f7c84d]" />
        <span className="size-2.5 rounded-full bg-[#67d68c]" />
        <span className="ml-3 rounded-lg bg-surface-muted px-3 py-1.5 font-mono text-[9px] text-muted">
          Werkstatt · Inventar
        </span>
        <span className="ml-auto rounded-full bg-success-soft px-2.5 py-1 text-[9px] font-semibold text-success">
          248 Einträge
        </span>
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-[1fr_0.72fr] sm:p-5">
        <div className="rounded-2xl border border-border bg-surface-subtle p-4">
          <div className="flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-xl bg-warning-soft text-warning">
              <Boxes className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                Akku-Bohrschrauber 18 V
              </p>
              <p className="mt-0.5 text-[10px] text-muted">
                Werkzeug · WERK-0042
              </p>
            </div>
            <span className="ml-auto rounded-full bg-success-soft px-2 py-1 text-[9px] font-semibold text-success">
              Verfügbar
            </span>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2">
            {[
              ["Bestand", "6 Stück"],
              ["Standort", "Regal B · 2"],
              ["Letzte Inventur", "12. Aug."],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-surface p-2.5">
                <p className="text-[8px] uppercase tracking-[0.12em] text-muted">
                  {label}
                </p>
                <p className="mt-1 text-[10px] font-semibold text-foreground">
                  {value}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {["18 V", "Elektrowerkzeug", "Akkusystem A"].map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-brand-soft px-2.5 py-1 text-[8px] font-medium text-brand"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-2xl bg-[#17181d] p-4 text-white">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/45">
            Heute erfasst
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-[-0.06em]">17</p>
          <div className="mt-5 space-y-2">
            {[
              ["Foto erkannt", "Akku-Lampe"],
              ["Code gescannt", "Kabeltrommel"],
              ["Bestand gebucht", "+ 24 Schrauben"],
            ].map(([action, item]) => (
              <div
                key={item}
                className="flex gap-2 rounded-xl bg-white/[0.06] p-2.5"
              >
                <Check
                  className="mt-0.5 size-3 shrink-0 text-[#8ff0cc]"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-[9px] font-semibold">{item}</p>
                  <p className="mt-0.5 text-[8px] text-white/45">{action}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="border-t border-border px-5 py-3 text-[9px] text-muted">
        Beispielansicht mit Mockdaten · keine echten Bestandsdaten
      </p>
    </div>
  );
}

export default function FeaturesPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <MarketingHeader />

      <main>
        <section className="relative overflow-hidden border-b border-border">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:56px_56px] opacity-55 [mask-image:linear-gradient(to_bottom,black,transparent_90%)]" />
          <div className="pointer-events-none absolute -left-20 top-28 size-[340px] rounded-full bg-[#8ff0cc]/25 blur-[110px]" />
          <div className="pointer-events-none absolute right-0 top-16 size-[430px] rounded-full bg-[#8175ff]/18 blur-[130px]" />

          <div className="relative mx-auto grid max-w-[1240px] items-center gap-14 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[0.88fr_1.12fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-brand-border bg-brand-soft px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.13em] text-brand">
                <Github className="size-3.5" aria-hidden="true" />
                Vollständig Open Source
              </div>
              <h1 className="mt-6 text-[clamp(3.3rem,6.5vw,6rem)] font-semibold leading-[0.91] tracking-[-0.07em]">
                Sekunden statt
                <span className="block text-brand">Stunden.</span>
              </h1>
              <p className="mt-7 max-w-xl text-[17px] leading-8 text-muted">
                Fotografieren, prüfen, fertig. Open Inventory macht die erste
                Erfassung schnell und bleibt stark, wenn dein Bestand wächst –
                vom Familienkeller bis zum Makerspace.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/docs#docker"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-brand-solid px-5 text-sm font-semibold text-on-brand shadow-[0_12px_30px_rgba(102,92,255,0.22)] transition hover:-translate-y-0.5 hover:bg-brand-hover"
                >
                  <Container className="size-[17px]" aria-hidden="true" />
                  Mit Docker starten
                </Link>
                <a
                  href={githubUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] border border-border bg-surface px-5 text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 hover:border-border-strong"
                >
                  Quellcode ansehen
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                </a>
              </div>
              <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[11px] font-semibold text-muted">
                {["MIT-Lizenz", "Self-hosted", "Web + native iOS-App"].map(
                  (item) => (
                    <span key={item} className="inline-flex items-center gap-1.5">
                      <Check
                        className="size-3 text-success"
                        strokeWidth={2.6}
                        aria-hidden="true"
                      />
                      {item}
                    </span>
                  ),
                )}
              </div>
            </div>
            <InventoryPreview />
          </div>
        </section>

        <section className="border-b border-border bg-surface py-16 sm:py-20">
          <div className="mx-auto grid max-w-[1240px] gap-8 px-5 sm:grid-cols-3 sm:px-8">
            {[
              ["1 Foto", "startet einen prüfbaren Datensatz"],
              ["1 Scan", "findet Objekt oder Lageraktion"],
              ["1 offener Stack", "Web, iOS und API im Repository"],
            ].map(([value, label]) => (
              <div key={value} className="border-l-2 border-brand-border pl-5">
                <p className="text-2xl font-semibold tracking-[-0.04em]">
                  {value}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-b border-border py-20 sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="grid items-end gap-8 lg:grid-cols-[1fr_0.72fr]">
              <div className="max-w-3xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                  So sieht der Alltag aus
                </p>
                <h2 className="mt-4 text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] sm:text-[58px]">
                  Echte Web-App. Greifbare Beispiele.
                </h2>
              </div>
              <p className="text-[15px] leading-7 text-muted">
                Die Aufnahmen zeigen die echte Open-Inventory-Weboberfläche mit
                eigens angelegten Beispieldaten – keine echten Personen-,
                Bestands- oder Unternehmensdaten.
              </p>
            </div>

            <div className="mt-12 grid gap-5 lg:grid-cols-2">
              {[
                {
                  src: "/marketing/inventory-mock-data.jpg",
                  title: "Inventar durchsuchen",
                  copy: "Objekte, Status, Tags und Orte auf einen Blick.",
                },
                {
                  src: "/marketing/stock-mock-data.jpg",
                  title: "Bestände steuern",
                  copy: "Verfügbarkeit, Mindestmengen und Nachbestellung im Kontext.",
                },
                {
                  src: "/marketing/batch-mock-data.jpg",
                  title: "Mehrere Dinge schnell erfassen",
                  copy: "Kamera-first Batch-Aufnahme für Sekunden statt Stunden.",
                },
              ].map((screenshot, index) => (
                <figure
                  key={screenshot.src}
                  className={`overflow-hidden rounded-[24px] border border-border bg-surface shadow-[var(--shadow-md)] ${
                    index === 2
                      ? "lg:col-span-2 lg:mx-auto lg:w-[calc(50%-0.625rem)]"
                      : ""
                  }`}
                >
                  <div className="relative overflow-hidden border-b border-border bg-surface-muted">
                    <Image
                      src={screenshot.src}
                      alt={`${screenshot.title} in der Open-Inventory-Web-App mit Beispieldaten`}
                      width={1440}
                      height={960}
                      sizes={
                        index === 2
                          ? "(max-width: 1024px) 100vw, 600px"
                          : "(max-width: 1024px) 100vw, 50vw"
                      }
                      className="h-auto w-full"
                    />
                    <span className="absolute left-3 top-3 rounded-full border border-white/30 bg-[#17181d]/85 px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.14em] text-white backdrop-blur">
                      Beispieldaten
                    </span>
                  </div>
                  <figcaption className="p-5">
                    <p className="text-[17px] font-semibold tracking-[-0.025em]">
                      {screenshot.title}
                    </p>
                    <p className="mt-1 text-[13px] leading-6 text-muted">
                      {screenshot.copy}
                    </p>
                  </figcaption>
                </figure>
              ))}
            </div>
            <p className="mt-4 text-[10px] text-muted">
              Screenshots der Web-App · sämtliche sichtbaren Inhalte sind
              Beispieldaten
            </p>
          </div>
        </section>

        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                Der vollständige Funktionskatalog
              </p>
              <h2 className="mt-4 text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] sm:text-[60px]">
                Alles erklärt. Nichts versteckt.
              </h2>
              <p className="mt-6 text-[17px] leading-8 text-muted">
                Jede Funktion gehört zum offenen Projekt. Externe KI-, Karten-,
                Login- oder Speicheranbieter sind optionale Konfigurationen.
              </p>
            </div>

            <div className="mt-20 space-y-24 sm:mt-24">
              {featureGroups.map((group) => (
                <section
                  id={group.slug}
                  key={group.slug}
                  className="scroll-mt-28"
                >
                  <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">
                        {group.eyebrow}
                      </p>
                      <h3 className="mt-4 text-[32px] font-semibold leading-[1.05] tracking-[-0.05em] sm:text-[42px]">
                        {group.title}
                      </h3>
                      <p className="mt-4 max-w-md text-[15px] leading-7 text-muted">
                        {group.intro}
                      </p>
                      <Link
                        href={`/features/${group.slug}`}
                        className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand transition hover:gap-3"
                      >
                        Bereich im Detail
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </Link>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        return (
                          <article
                            key={item.title}
                            className="rounded-[22px] border border-border bg-surface p-5 transition duration-300 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-md)]"
                          >
                            <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
                              <Icon
                                className="size-[18px]"
                                strokeWidth={1.9}
                                aria-hidden="true"
                              />
                            </span>
                            <h4 className="mt-5 text-[17px] font-semibold tracking-[-0.025em]">
                              {item.title}
                            </h4>
                            <p className="mt-2 text-[13px] leading-6 text-muted">
                              {item.copy}
                            </p>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                </section>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-surface py-20 sm:py-28">
          <div className="mx-auto grid max-w-[1240px] items-center gap-10 px-5 sm:px-8 lg:grid-cols-[1fr_auto]">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                Offen bis ins Detail
              </p>
              <h2 className="mt-4 text-[38px] font-semibold leading-[1] tracking-[-0.055em] sm:text-[52px]">
                Prüfe den Code. Passe den Ablauf an. Behalte die Kontrolle.
              </h2>
              <p className="mt-5 text-[16px] leading-7 text-muted">
                Open Inventory ist MIT-lizenziert. Die Web-App, die native
                iOS-App, Migrationen und der OpenAPI-Vertrag liegen gemeinsam
                im öffentlichen Repository.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <Link
                href="/open-source"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-strong px-5 text-sm font-semibold text-on-strong transition hover:-translate-y-0.5 hover:opacity-90"
              >
                Open Source entdecken
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <Link
                href="/ios"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] border border-border px-5 text-sm font-semibold transition hover:bg-surface-muted"
              >
                iOS-App ansehen
                <Smartphone className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
