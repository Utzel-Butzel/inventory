import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Camera,
  Check,
  Container,
  Github,
  PackageSearch,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
} from "lucide-react";

import {
  MarketingFooter,
  MarketingHeader,
} from "@/components/marketing/site-chrome";

import { useCases, type UseCase } from "./use-cases";

const githubUrl = "https://github.com/Utzel-Butzel/inventory";

export const metadata: Metadata = {
  title: { absolute: "Open Inventory für Alltag, Teams und Sammlungen" },
  description:
    "Use Cases für Open Inventory: Makerspaces, Familien, Startups, Vereine und Sammlungen. Schnell erfassen, selbst hosten und unter MIT-Lizenz anpassen.",
  alternates: { canonical: "/use-cases" },
  openGraph: {
    title: "Open Inventory für Alltag, Teams und Sammlungen",
    description:
      "Inventarisieren in Sekunden statt Stunden — mit nativer iOS-App, Docker und einer offenen MIT-lizenzierten Codebasis.",
    images: ["/marketing/usecase-makerspace-v2.webp"],
  },
};

function VisualPlaceholder({ useCase }: { useCase: UseCase }) {
  const isClub = useCase.visual === "club";
  const Icon = isClub ? Users : PackageSearch;

  return (
    <div
      className={`relative h-full min-h-[260px] overflow-hidden ${
        isClub
          ? "bg-[linear-gradient(145deg,#173e36,#0b2220)]"
          : "bg-[linear-gradient(145deg,#34240f,#17130d)]"
      }`}
      aria-hidden="true"
    >
      <div className="absolute -right-12 -top-12 size-52 rounded-full bg-white/10 blur-2xl" />
      <div className="absolute bottom-8 left-8 right-8 rounded-[22px] border border-white/15 bg-white/10 p-5 text-white shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-white/15">
            <Icon className="size-5" />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-white/55">
              Beispieldaten
            </p>
            <p className="mt-1 text-sm font-semibold">
              {isClub ? "Materialausgabe" : "Sammlungskatalog"}
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-2">
          {useCase.mockData.slice(0, 2).map((row) => (
            <div
              key={row.name}
              className="flex items-center gap-3 rounded-xl bg-black/15 px-3 py-2.5"
            >
              <span className="size-2 rounded-full bg-[#8ff0cc]" />
              <span className="min-w-0 flex-1 truncate text-xs text-white/85">
                {row.name}
              </span>
              <span className="text-[9px] text-white/45">{row.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const cardSpans = [
  "md:col-span-2 lg:col-span-7",
  "md:col-span-1 lg:col-span-5",
  "md:col-span-1 lg:col-span-4",
  "md:col-span-1 lg:col-span-4",
  "md:col-span-1 lg:col-span-4",
  "md:col-span-1 lg:col-span-4",
  "md:col-span-1 lg:col-span-4",
  "md:col-span-2 lg:col-span-4",
];

export default function UseCasesPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <MarketingHeader />

      <main>
        <section className="relative overflow-hidden border-b border-border">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:64px_64px] opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent_88%)]" />
          <div className="pointer-events-none absolute left-[8%] top-12 size-80 rounded-full bg-[#8ff0cc]/25 blur-[110px]" />
          <div className="pointer-events-none absolute right-[8%] top-24 size-96 rounded-full bg-[#8175ff]/20 blur-[125px]" />

          <div className="relative mx-auto max-w-[1240px] px-5 pb-20 pt-16 sm:px-8 sm:pb-28 sm:pt-24">
            <div className="grid gap-12 lg:grid-cols-[1fr_0.72fr] lg:items-end">
              <div className="max-w-4xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                  Für Dinge, die wirklich benutzt werden
                </p>
                <h1 className="mt-5 text-[clamp(3.25rem,7vw,6.6rem)] font-semibold leading-[0.9] tracking-[-0.07em]">
                  Inventarisieren in
                  <span className="block text-brand">Sekunden statt Stunden.</span>
                </h1>
                <p className="mt-7 max-w-[760px] text-[17px] leading-7 text-muted sm:text-[20px] sm:leading-8">
                  Ein Foto als Anfang, ein prüfbarer Datensatz als Ergebnis.
                  Open Inventory passt zu Werkstatt, Haushalt, Team und Sammlung
                  — selbst gehostet, MIT-lizenziert und offen erweiterbar.
                </p>
              </div>

              <div className="rounded-[28px] border border-border bg-surface/90 p-5 shadow-[var(--shadow-md)] backdrop-blur sm:p-6">
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-4">
                  {[
                    [Camera, "Foto aufnehmen", "statt jedes Feld einzeln zu tippen"],
                    [Smartphone, "Unterwegs erfassen", "mit der nativen iOS-App im Repository"],
                    [ShieldCheck, "Selbst betreiben", "mit Docker und deinen eigenen Daten"],
                  ].map(([Icon, title, copy]) => {
                    const ItemIcon = Icon as typeof Camera;
                    return (
                      <div key={title as string} className="contents">
                        <span className="grid size-10 place-items-center rounded-2xl bg-brand-soft text-brand">
                          <ItemIcon className="size-[18px]" />
                        </span>
                        <div className="pt-0.5">
                          <p className="text-sm font-semibold">{title as string}</p>
                          <p className="mt-0.5 text-xs leading-5 text-muted">{copy as string}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                Acht konkrete Einstiege
              </p>
              <h2 className="mt-4 text-[42px] font-semibold leading-[0.98] tracking-[-0.055em] sm:text-[60px]">
                Ein offenes System. Dein eigener Alltag.
              </h2>
              <p className="mt-5 text-[16px] leading-7 text-muted sm:text-[18px]">
                Jede Seite zeigt einen realistischen Ablauf, passende Funktionen
                und Beispieldaten — ohne einen Spezialtarif oder eine
                geschlossene Branchenlösung vorauszusetzen.
              </p>
            </div>

            <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-12">
              {useCases.map((useCase, index) => (
                <Link
                  key={useCase.slug}
                  href={`/use-cases/${useCase.slug}`}
                  className={`group overflow-hidden rounded-[28px] border border-border bg-surface shadow-sm transition duration-300 hover:-translate-y-1 hover:border-border-strong hover:shadow-[var(--shadow-md)] ${cardSpans[index]}`}
                >
                  <div className="relative aspect-[16/9] overflow-hidden">
                    {useCase.image ? (
                      <Image
                        src={useCase.image}
                        alt={useCase.imageAlt ?? ""}
                        fill
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 700px"
                        className="object-cover transition duration-700 group-hover:scale-[1.025]"
                      />
                    ) : (
                      <VisualPlaceholder useCase={useCase} />
                    )}
                    <span className="absolute left-4 top-4 rounded-full border border-white/20 bg-black/45 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.15em] text-white backdrop-blur-md">
                      {useCase.eyebrow}
                    </span>
                  </div>
                  <div className="p-6 sm:p-7">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="text-[28px] font-semibold tracking-[-0.045em]">
                        {useCase.name}
                      </h3>
                      <span className="grid size-9 shrink-0 place-items-center rounded-full border border-border text-muted transition group-hover:border-brand-border group-hover:bg-brand-soft group-hover:text-brand">
                        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </div>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
                      {useCase.cardCopy}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-surface-subtle py-20 sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                  Gemeinsame Basis
                </p>
                <h2 className="mt-4 text-[40px] font-semibold leading-none tracking-[-0.055em] sm:text-[54px]">
                  Schnell anfangen. Später tiefer gehen.
                </h2>
                <p className="mt-5 text-[16px] leading-7 text-muted">
                  Die Kamera senkt die Einstiegshürde. Strukturierte Daten,
                  Bestandsführung und offene Schnittstellen sind schon da, wenn
                  aus zehn Gegenständen zehntausend werden.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  {
                    icon: Sparkles,
                    title: "Prüfbare KI-Vorschläge",
                    copy: "Bildanalyse schlägt Titel, Beschreibung, Typ und Tags vor. Du entscheidest, was übernommen wird.",
                  },
                  {
                    icon: ScanLine,
                    title: "Codes & Bestandsverlauf",
                    copy: "QR, Barcode, Mengenbestand, Einzelgeräte und datierte Bewegungen bleiben in einem Modell verbunden.",
                  },
                  {
                    icon: Smartphone,
                    title: "Native iOS-Begleitung",
                    copy: "SwiftUI-App für Kamera, Codes, Suche, Bestand und optional LiDAR-Raumerfassung — im selben Repository.",
                  },
                  {
                    icon: Github,
                    title: "MIT Open Source",
                    copy: "Code, iOS-App und OpenAPI sind offen. Docker bringt die Instanz auf Infrastruktur unter deiner Kontrolle.",
                  },
                ].map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <article
                      key={feature.title}
                      className="rounded-[24px] border border-border bg-surface p-6"
                    >
                      <span className="grid size-11 place-items-center rounded-2xl bg-brand-soft text-brand">
                        <Icon className="size-5" />
                      </span>
                      <h3 className="mt-8 text-xl font-semibold tracking-[-0.035em]">
                        {feature.title}
                      </h3>
                      <p className="mt-3 text-sm leading-6 text-muted">
                        {feature.copy}
                      </p>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden bg-[#121318] py-20 text-white sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="relative overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(135deg,#1a1b21,#22202f)] px-6 py-12 sm:px-12 sm:py-16 lg:px-16">
              <div className="pointer-events-none absolute -right-16 -top-24 size-80 rounded-full bg-[#8175ff]/25 blur-[100px]" />
              <div className="pointer-events-none absolute -bottom-24 left-1/4 size-72 rounded-full bg-[#8ff0cc]/15 blur-[100px]" />
              <div className="relative grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
                <div className="max-w-3xl">
                  <div className="flex flex-wrap gap-2">
                    {["MIT-lizenziert", "Self-hosted", "Keine Branchen-Blackbox"].map(
                      (item) => (
                        <span
                          key={item}
                          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-semibold text-white/65"
                        >
                          <Check className="size-3 text-[#8ff0cc]" />
                          {item}
                        </span>
                      ),
                    )}
                  </div>
                  <h2 className="mt-6 text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] sm:text-[62px]">
                    Deine Dinge. Deine Daten. Dein Server.
                  </h2>
                  <p className="mt-5 max-w-2xl text-[16px] leading-7 text-white/55">
                    Installiere Open Inventory mit Docker, prüfe den Quellcode
                    oder passe den Workflow an. Open Source ist hier kein
                    Exportknopf, sondern die Grundlage des Produkts.
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                  <Link
                    href="/docs#docker"
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-[#675ee5] px-5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#756de8]"
                  >
                    <Container className="size-4" />
                    Mit Docker starten
                  </Link>
                  <a
                    href={githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] border border-white/15 bg-white/5 px-5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-white/10"
                  >
                    <Github className="size-4" />
                    Code auf GitHub
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
