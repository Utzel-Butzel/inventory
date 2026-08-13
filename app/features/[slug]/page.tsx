import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Container,
  Github,
  KeyRound,
  ShieldCheck,
  Smartphone,
} from "lucide-react";

import {
  MarketingFooter,
  MarketingHeader,
} from "@/components/marketing/site-chrome";

import {
  featureGroups,
  getFeatureGroup,
  type FeatureGroup,
} from "../features";

const githubUrl = "https://github.com/Utzel-Butzel/inventory";
const licenseUrl = `${githubUrl}/blob/main/LICENSE`;
const openApiUrl = `${githubUrl}/blob/main/public/openapi.yaml`;

type FeaturePageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return featureGroups.map((group) => ({ slug: group.slug }));
}

export async function generateMetadata({
  params,
}: FeaturePageProps): Promise<Metadata> {
  const { slug } = await params;
  const group = getFeatureGroup(slug);

  if (!group) return {};

  return {
    title: { absolute: `${group.menuTitle} — Open Inventory` },
    description: group.description,
    alternates: { canonical: `/features/${group.slug}` },
    openGraph: {
      title: `${group.menuTitle} — Open Inventory`,
      description: group.description,
      images: [group.screenshot.src],
    },
  };
}

function ProductScreenshot({ group }: { group: FeatureGroup }) {
  return (
    <figure className="relative overflow-hidden rounded-[28px] border border-border bg-surface shadow-[0_34px_100px_rgba(23,23,35,0.18)]">
      <div className="flex h-11 items-center gap-1.5 border-b border-border bg-surface px-4">
        <span className="size-2 rounded-full bg-[#ff6a64]" />
        <span className="size-2 rounded-full bg-[#f7c84d]" />
        <span className="size-2 rounded-full bg-[#67d68c]" />
        <span className="ml-3 font-mono text-[8px] text-muted">
          app.open-inventory.local
        </span>
        <span className="ml-auto rounded-full bg-brand-soft px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.11em] text-brand">
          Beispieldaten
        </span>
      </div>
      <Image
        src={group.screenshot.src}
        alt={group.screenshot.alt}
        width={1440}
        height={960}
        priority
        sizes="(max-width: 1024px) 100vw, 55vw"
        className="h-auto w-full"
      />
      <figcaption className="border-t border-border px-5 py-3 text-[9px] text-muted">
        {group.screenshot.caption}
      </figcaption>
    </figure>
  );
}

function ExamplePanel({ group }: { group: FeatureGroup }) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#1a1b21] shadow-2xl">
      <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4">
        <span className="size-2 rounded-full bg-[#ff6a64]" />
        <span className="size-2 rounded-full bg-[#f7c84d]" />
        <span className="size-2 rounded-full bg-[#67d68c]" />
        <span className="ml-3 font-mono text-[9px] text-white/35">
          konkretes Beispiel
        </span>
      </div>
      <div className="p-5 sm:p-7">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8ff0cc]">
          {group.example.eyebrow}
        </p>
        <h3 className="mt-4 text-[30px] font-semibold leading-[1.02] tracking-[-0.05em] text-white sm:text-[38px]">
          {group.example.title}
        </h3>
        <p className="mt-4 max-w-xl text-[14px] leading-7 text-white/55">
          {group.example.copy}
        </p>
        <div className="mt-8 grid gap-2 sm:grid-cols-3">
          {group.example.facts.map((fact) => (
            <div
              key={fact.label}
              className="rounded-2xl border border-white/10 bg-white/[0.045] p-4"
            >
              <p className="text-[8px] font-semibold uppercase tracking-[0.14em] text-white/35">
                {fact.label}
              </p>
              <p className="mt-3 text-[12px] font-semibold leading-5 text-white/90">
                {fact.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default async function FeatureDetailPage({ params }: FeaturePageProps) {
  const { slug } = await params;
  const group = getFeatureGroup(slug);

  if (!group) {
    notFound();
  }

  const currentIndex = featureGroups.findIndex(
    (item) => item.slug === group.slug,
  );
  const nextGroup = featureGroups[(currentIndex + 1) % featureGroups.length];

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <MarketingHeader />

      <main>
        <section className="relative overflow-hidden border-b border-border">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:60px_60px] opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent_92%)]" />
          <div className="pointer-events-none absolute -left-24 top-24 size-[380px] rounded-full bg-[#8ff0cc]/24 blur-[120px]" />
          <div className="pointer-events-none absolute right-0 top-12 size-[460px] rounded-full bg-[#8175ff]/18 blur-[135px]" />

          <div className="relative mx-auto max-w-[1240px] px-5 pb-20 pt-8 sm:px-8 sm:pb-28 sm:pt-12">
            <Link
              href="/features"
              className="inline-flex items-center gap-2 rounded-lg text-xs font-semibold text-muted transition hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Alle Funktionen
            </Link>

            <div className="mt-10 grid items-center gap-14 lg:grid-cols-[0.88fr_1.12fr] lg:gap-12">
              <div className="relative z-10 max-w-[650px]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                  {group.eyebrow}
                </p>
                <h1 className="mt-5 text-[clamp(3.15rem,6.2vw,5.9rem)] font-semibold leading-[0.91] tracking-[-0.068em]">
                  {group.title}
                </h1>
                <p className="mt-7 text-[17px] leading-7 text-muted sm:text-[19px] sm:leading-8">
                  {group.intro}
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/docs#docker"
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-brand-solid px-5 text-sm font-semibold text-on-brand shadow-[0_12px_30px_rgba(102,92,255,0.24)] transition hover:-translate-y-0.5 hover:bg-brand-hover"
                  >
                    <Container className="size-4" aria-hidden="true" />
                    Open Source selbst hosten
                  </Link>
                  <a
                    href={githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] border border-border bg-surface px-5 text-sm font-semibold transition hover:-translate-y-0.5 hover:border-border-strong"
                  >
                    <Github className="size-4" aria-hidden="true" />
                    GitHub ansehen
                  </a>
                </div>
                <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[11px] font-semibold text-muted">
                  {["MIT-Lizenz", "Self-hosted", "Native iOS-App"].map(
                    (item) => (
                      <span key={item} className="flex items-center gap-1.5">
                        <Check
                          className="size-3 text-success"
                          strokeWidth={2.5}
                          aria-hidden="true"
                        />
                        {item}
                      </span>
                    ),
                  )}
                </div>
              </div>

              <ProductScreenshot group={group} />
            </div>
          </div>
        </section>

        <section className="py-20 sm:py-28">
          <div className="mx-auto grid max-w-[1240px] gap-12 px-5 sm:px-8 lg:grid-cols-[0.78fr_1.22fr] lg:gap-20">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                Was der Bereich löst
              </p>
              <h2 className="mt-4 text-[40px] font-semibold leading-[1.02] tracking-[-0.055em] sm:text-[56px]">
                Schnell im Alltag. Präzise im System.
              </h2>
              <p className="mt-6 text-[16px] leading-8 text-muted">
                {group.detailIntro}
              </p>
            </div>
            <div className="grid content-start gap-3">
              {group.outcomes.map((outcome, index) => (
                <div
                  key={outcome}
                  className="flex gap-4 rounded-[20px] border border-border bg-surface p-5"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-success-soft text-success">
                    <Check className="size-4" strokeWidth={2.5} aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">
                      Ergebnis {String(index + 1).padStart(2, "0")}
                    </p>
                    <p className="mt-2 text-[15px] font-medium leading-6">
                      {outcome}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-surface-subtle py-20 sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                Alle Funktionen in diesem Bereich
              </p>
              <h2 className="mt-4 text-[42px] font-semibold leading-[0.98] tracking-[-0.055em] sm:text-[60px]">
                Jede Funktion konkret erklärt.
              </h2>
              <p className="mt-5 text-[16px] leading-7 text-muted">
                Keine künstliche Paketgrenze: Diese Bausteine gehören zum
                MIT-lizenzierten Open-Source-Projekt.
              </p>
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.items.map((item, index) => {
                const Icon = item.icon;
                return (
                  <article
                    key={item.title}
                    className="rounded-[24px] border border-border bg-surface p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-border-strong hover:shadow-[var(--shadow-md)]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="grid size-11 place-items-center rounded-2xl bg-brand-soft text-brand">
                        <Icon
                          className="size-5"
                          strokeWidth={1.9}
                          aria-hidden="true"
                        />
                      </span>
                      <span className="font-mono text-[9px] text-muted">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <h3 className="mt-9 text-[21px] font-semibold tracking-[-0.04em]">
                      {item.title}
                    </h3>
                    <p className="mt-3 text-[14px] leading-6 text-muted">
                      {item.copy}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                  Der Ablauf
                </p>
                <h2 className="mt-4 text-[40px] font-semibold leading-[1.02] tracking-[-0.055em] sm:text-[54px]">
                  {group.workflowTitle}
                </h2>
                <p className="mt-5 text-[15px] leading-7 text-muted">
                  {group.workflowIntro}
                </p>
              </div>
              <ol className="grid gap-3 sm:grid-cols-2">
                {group.workflow.map((step, index) => (
                  <li
                    key={step.title}
                    className="relative rounded-[22px] border border-border bg-surface p-5"
                  >
                    <span className="grid size-9 place-items-center rounded-xl bg-strong font-mono text-[10px] font-semibold text-on-strong">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="mt-8 text-[18px] font-semibold tracking-[-0.03em]">
                      {step.title}
                    </h3>
                    <p className="mt-2 text-[13px] leading-6 text-muted">
                      {step.copy}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="overflow-hidden bg-[#121318] py-20 text-white sm:py-28">
          <div className="mx-auto grid max-w-[1240px] items-center gap-12 px-5 sm:px-8 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ff0cc]">
                Kein abstraktes Versprechen
              </p>
              <h2 className="mt-4 text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] sm:text-[60px]">
                So sieht es mit echten Abläufen aus.
              </h2>
              <p className="mt-6 max-w-xl text-[16px] leading-7 text-white/55">
                Das Beispiel zeigt bewusst konkrete Gegenstände, Werte und
                Entscheidungen. Es sind Mockdaten, aber ein Ablauf, den Open
                Inventory tatsächlich abbildet.
              </p>
            </div>
            <ExamplePanel group={group} />
          </div>
        </section>

        <section className="border-b border-border bg-surface py-20 sm:py-28">
          <div className="mx-auto grid max-w-[1240px] items-center gap-12 px-5 sm:px-8 lg:grid-cols-[0.82fr_1.18fr] lg:gap-20">
            <div className="relative mx-auto grid aspect-square w-full max-w-[340px] place-items-center rounded-[34px] border border-border bg-[radial-gradient(circle_at_30%_20%,var(--color-brand-soft),var(--color-surface)_62%)] shadow-[var(--shadow-md)]">
              <div className="absolute inset-8 rounded-[28px] border border-border/70" />
              <span className="relative grid size-24 place-items-center rounded-[28px] bg-brand-solid text-on-brand shadow-[0_22px_50px_rgba(102,92,255,0.28)]">
                <Smartphone className="size-11" strokeWidth={1.6} aria-hidden="true" />
              </span>
              <span className="absolute bottom-8 rounded-full border border-border bg-surface px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-brand shadow-sm">
                Native SwiftUI-App
              </span>
            </div>
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-brand-border bg-brand-soft px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand">
                <Smartphone className="size-3.5" aria-hidden="true" />
                Open Source für iOS
              </div>
              <h2 className="mt-6 text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] sm:text-[60px]">
                {group.ios.title}
              </h2>
              <p className="mt-5 max-w-2xl text-[16px] leading-7 text-muted">
                {group.ios.copy}
              </p>
              <div className="mt-7 grid gap-3">
                {group.ios.points.map((point) => (
                  <p key={point} className="flex gap-3 text-sm leading-6">
                    <Check
                      className="mt-1 size-4 shrink-0 text-success"
                      strokeWidth={2.4}
                      aria-hidden="true"
                    />
                    {point}
                  </p>
                ))}
              </div>
              <Link
                href="/ios"
                className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-brand transition hover:gap-3"
              >
                Native iOS-App im Detail
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="overflow-hidden rounded-[30px] border border-border bg-surface shadow-[var(--shadow-md)]">
              <div className="grid gap-10 p-6 sm:p-10 lg:grid-cols-[0.86fr_1.14fr] lg:p-14">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-success-soft px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-success">
                    <Github className="size-3.5" aria-hidden="true" />
                    MIT Open Source
                  </div>
                  <h2 className="mt-6 text-[38px] font-semibold leading-[1] tracking-[-0.055em] sm:text-[52px]">
                    {group.trustTitle}
                  </h2>
                  <p className="mt-5 text-[15px] leading-7 text-muted">
                    {group.trustCopy}
                  </p>
                </div>
                <div>
                  <div className="grid gap-3">
                    {group.trustPoints.map((point) => (
                      <div
                        key={point}
                        className="flex gap-3 rounded-2xl border border-border bg-surface-subtle p-4"
                      >
                        <ShieldCheck
                          className="mt-0.5 size-4 shrink-0 text-success"
                          aria-hidden="true"
                        />
                        <p className="text-[13px] leading-6">{point}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <a
                      href={licenseUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-3.5 text-xs font-semibold transition hover:bg-surface-muted"
                    >
                      MIT-Lizenz
                      <ArrowUpRight className="size-3.5" aria-hidden="true" />
                    </a>
                    <a
                      href={openApiUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-3.5 text-xs font-semibold transition hover:bg-surface-muted"
                    >
                      <KeyRound className="size-3.5" aria-hidden="true" />
                      OpenAPI 3.1
                    </a>
                    <Link
                      href="/open-source"
                      className="inline-flex h-10 items-center gap-2 rounded-xl bg-strong px-3.5 text-xs font-semibold text-on-strong transition hover:opacity-90"
                    >
                      Open-Source-Basis
                      <ArrowRight className="size-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-border bg-surface-subtle py-20 sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
              <Link
                href={`/features/${nextGroup.slug}`}
                className="group rounded-[28px] border border-border bg-surface p-7 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-border-strong hover:shadow-[var(--shadow-md)] sm:p-9"
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-brand">
                  Nächster Funktionsbereich
                </p>
                <div className="mt-6 flex items-end justify-between gap-6">
                  <div>
                    <h2 className="text-[32px] font-semibold leading-none tracking-[-0.05em] sm:text-[42px]">
                      {nextGroup.menuTitle}
                    </h2>
                    <p className="mt-3 max-w-lg text-sm leading-6 text-muted">
                      {nextGroup.intro}
                    </p>
                  </div>
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-soft text-brand transition group-hover:translate-x-1">
                    <ArrowRight className="size-5" aria-hidden="true" />
                  </span>
                </div>
              </Link>

              <div className="rounded-[28px] bg-[#121318] p-7 text-white shadow-sm sm:p-9">
                <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-[#8ff0cc]">
                  Inventarisieren in Sekunden
                </p>
                <h2 className="mt-5 text-[32px] font-semibold leading-none tracking-[-0.05em] sm:text-[42px]">
                  Auf deiner Infrastruktur starten.
                </h2>
                <p className="mt-4 max-w-lg text-sm leading-6 text-white/50">
                  Open Inventory ist MIT-lizenziert. Starte den Docker-Stack,
                  prüfe den Code oder entdecke passende Abläufe für deinen Use
                  Case.
                </p>
                <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/docs#docker"
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-xs font-semibold text-[#17181d] transition hover:-translate-y-0.5"
                  >
                    <Container className="size-4" aria-hidden="true" />
                    Docker-Anleitung
                  </Link>
                  <Link
                    href="/use-cases"
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 text-xs font-semibold transition hover:bg-white/10"
                  >
                    Use Cases ansehen
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
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
