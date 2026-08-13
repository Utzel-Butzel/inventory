import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Braces,
  Camera,
  Check,
  CircleDot,
  Container,
  FileSpreadsheet,
  Github,
  History,
  Languages,
  MapPinned,
  Network,
  PackageCheck,
  PackageSearch,
  ScanLine,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from "lucide-react";

import {
  MarketingFooter,
  MarketingHeader,
} from "@/components/marketing/site-chrome";

import {
  getUseCase,
  useCases,
  type UseCase,
  type UseCaseIcon,
} from "../use-cases";

const githubUrl = "https://github.com/Utzel-Butzel/inventory";

const featureIcons: Record<UseCaseIcon, LucideIcon> = {
  api: Braces,
  camera: Camera,
  csv: FileSpreadsheet,
  history: History,
  labels: ScanLine,
  languages: Languages,
  locations: MapPinned,
  orders: PackageCheck,
  relations: Network,
  roles: ShieldCheck,
  sharing: Share2,
  stock: Boxes,
};

type UseCasePageProps = {
  params: Promise<{ slug: string }>;
};

export const dynamicParams = false;

export function generateStaticParams() {
  return useCases.map((useCase) => ({ slug: useCase.slug }));
}

export async function generateMetadata({
  params,
}: UseCasePageProps): Promise<Metadata> {
  const { slug } = await params;
  const useCase = getUseCase(slug);

  if (!useCase) {
    return { title: "Use Case nicht gefunden" };
  }

  return {
    title: { absolute: `Open Inventory für ${useCase.name}` },
    description: useCase.cardCopy,
    alternates: { canonical: `/use-cases/${useCase.slug}` },
    openGraph: {
      title: `Open Inventory für ${useCase.name}`,
      description: useCase.cardCopy,
      images: [useCase.image ?? "/og.png"],
    },
  };
}

function HeroVisual({ useCase }: { useCase: UseCase }) {
  return (
    <Image
      src={useCase.image ?? "/og.png"}
      alt={useCase.imageAlt ?? `${useCase.name} im Inventaralltag`}
      fill
      priority
      sizes="(max-width: 1024px) 100vw, 52vw"
      className="object-cover"
    />
  );
}

function MockInventory({ useCase }: { useCase: UseCase }) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-border bg-[#17181d] p-2.5 shadow-[0_30px_80px_rgba(18,20,28,0.2)]">
      <div className="flex h-9 items-center gap-1.5 px-3">
        <span className="size-2 rounded-full bg-white/20" />
        <span className="size-2 rounded-full bg-white/20" />
        <span className="size-2 rounded-full bg-white/20" />
        <span className="ml-auto font-mono text-[8px] uppercase tracking-[0.14em] text-white/45">
          Beispieldaten · keine Echtdaten
        </span>
      </div>
      <div className="rounded-[20px] bg-background p-4 sm:p-5">
        <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-brand">
              {useCase.name}-Inventar
            </p>
            <p className="mt-1 text-lg font-semibold tracking-[-0.035em]">
              Zuletzt aktualisiert
            </p>
          </div>
          <span className="rounded-full bg-success-soft px-2.5 py-1.5 text-[8px] font-semibold text-success">
            3 Einträge
          </span>
        </div>
        <div className="mt-3 grid gap-2">
          {useCase.mockData.map((row, index) => (
            <div
              key={row.name}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-border bg-surface p-3"
            >
              <span
                className={`grid size-10 place-items-center rounded-xl ${
                  index === 0
                    ? "bg-brand-soft text-brand"
                    : index === 1
                      ? "bg-success-soft text-success"
                      : "bg-warning-soft text-warning"
                }`}
              >
                <Boxes className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold">{row.name}</p>
                <p className="mt-1 truncate text-[9px] text-muted">{row.meta}</p>
              </div>
              <span className="hidden rounded-full bg-surface-muted px-2 py-1 text-[8px] font-semibold text-muted-strong sm:block">
                {row.status}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <span className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-solid text-[9px] font-semibold text-on-brand">
            <Camera className="size-3" /> Neues Foto
          </span>
          <span className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface text-[9px] font-semibold">
            <ScanLine className="size-3" /> Code scannen
          </span>
        </div>
      </div>
    </div>
  );
}

function IosPhone({ useCase }: { useCase: UseCase }) {
  const item = useCase.mockData[0];

  return (
    <div className="relative mx-auto w-[260px] rounded-[46px] border-[7px] border-[#090a0c] bg-[#090a0c] p-2 shadow-[0_35px_90px_rgba(0,0,0,0.45)]">
      <div className="absolute left-1/2 top-3 z-10 h-5 w-20 -translate-x-1/2 rounded-full bg-[#090a0c]" />
      <div className="min-h-[510px] overflow-hidden rounded-[35px] bg-[#f4f5f7] text-[#17181d]">
        <div className="px-4 pb-4 pt-10">
          <div className="flex items-center justify-between">
            <Image
              src="/marketing/ios-app-icon-current.png"
              width={34}
              height={34}
              alt="Open Inventory App-Icon"
              className="rounded-[9px]"
            />
            <span className="rounded-full bg-[#e7e5ff] px-2.5 py-1 text-[8px] font-semibold text-[#5147d9]">
              Verbunden
            </span>
          </div>
          <p className="mt-7 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#777b84]">
            {useCase.name}
          </p>
          <h3 className="mt-1 text-[24px] font-semibold leading-none tracking-[-0.05em]">
            Schnell erfassen
          </h3>
          <div className="relative mt-5 aspect-[3/4] overflow-hidden rounded-[24px] bg-[linear-gradient(145deg,#292c32,#17191d)] p-4 text-white">
            <div className="absolute inset-x-0 top-1/3 h-px bg-white/10" />
            <div className="absolute inset-y-0 left-1/3 w-px bg-white/10" />
            <div className="absolute inset-y-0 right-1/3 w-px bg-white/10" />
            <span className="absolute left-1/2 top-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-3xl border border-white/15 bg-white/10">
              <PackageSearch className="size-7 text-[#8ff0cc]" />
            </span>
            <span className="absolute bottom-4 left-4 right-4 rounded-2xl border border-white/10 bg-black/35 p-3 backdrop-blur">
              <span className="block truncate text-[10px] font-semibold">{item.name}</span>
              <span className="mt-1 block truncate text-[8px] text-white/50">{item.meta}</span>
            </span>
          </div>
          <div className="mt-4 flex items-center justify-around">
            {[Camera, ScanLine, Boxes].map((Icon, index) => (
              <span
                key={index}
                className={`grid size-10 place-items-center rounded-full ${
                  index === 0 ? "bg-[#675ee5] text-white" : "bg-white text-[#6d717a]"
                }`}
              >
                <Icon className="size-4" />
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function UseCaseDetailPage({ params }: UseCasePageProps) {
  const { slug } = await params;
  const useCase = getUseCase(slug);

  if (!useCase) {
    notFound();
  }

  const currentIndex = useCases.findIndex((item) => item.slug === useCase.slug);
  const nextUseCase = useCases[(currentIndex + 1) % useCases.length];

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <MarketingHeader />

      <main>
        <section className="relative overflow-hidden border-b border-border">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:64px_64px] opacity-45 [mask-image:linear-gradient(to_bottom,black,transparent_92%)]" />
          <div className="relative mx-auto max-w-[1240px] px-5 pb-20 pt-8 sm:px-8 sm:pb-28 sm:pt-12">
            <Link
              href="/use-cases"
              className="inline-flex items-center gap-2 rounded-lg text-xs font-semibold text-muted transition hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              Alle Use Cases
            </Link>

            <div className="mt-10 grid gap-14 lg:grid-cols-[0.88fr_1.12fr] lg:items-center lg:gap-12">
              <div className="relative z-10 max-w-[660px]">
                <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${useCase.accent}`}>
                  Open Inventory für {useCase.name}
                </p>
                <h1 className="mt-5 text-[clamp(3.15rem,6.2vw,6rem)] font-semibold leading-[0.91] tracking-[-0.068em]">
                  {useCase.title}
                </h1>
                <p className="mt-7 text-[17px] leading-7 text-muted sm:text-[19px] sm:leading-8">
                  {useCase.description}
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/docs#docker"
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-brand-solid px-5 text-sm font-semibold text-on-brand shadow-[0_12px_30px_rgba(102,92,255,0.24)] transition hover:-translate-y-0.5 hover:bg-brand-hover"
                  >
                    <Container className="size-4" />
                    Open Source selbst hosten
                  </Link>
                  <a
                    href={githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] border border-border bg-surface px-5 text-sm font-semibold transition hover:-translate-y-0.5 hover:border-border-strong"
                  >
                    <Github className="size-4" />
                    GitHub ansehen
                  </a>
                </div>
                <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[11px] font-semibold text-muted">
                  {["MIT-Lizenz", "Self-hosted", "Native iOS-App"].map((item) => (
                    <span key={item} className="flex items-center gap-1.5">
                      <Check className="size-3 text-success" strokeWidth={2.5} />
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <div className="relative">
                <div className="pointer-events-none absolute -left-12 top-16 size-52 rounded-full bg-[#8ff0cc]/30 blur-[80px]" />
                <div className="pointer-events-none absolute -right-10 bottom-8 size-64 rounded-full bg-[#8175ff]/25 blur-[90px]" />
                <div className="relative aspect-[4/3] overflow-hidden rounded-[30px] border border-border bg-surface shadow-[0_36px_100px_rgba(23,23,35,0.2)]">
                  <HeroVisual useCase={useCase} />
                  <div className="absolute bottom-4 left-4 right-4 flex items-center gap-3 rounded-2xl border border-white/15 bg-black/45 p-3.5 text-white backdrop-blur-md">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#8ff0cc]/20 text-[#8ff0cc]">
                      <Sparkles className="size-4" />
                    </span>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/50">
                        Der schnelle Einstieg
                      </p>
                      <p className="mt-0.5 text-xs font-semibold">
                        Foto aufnehmen · Vorschlag prüfen · speichern
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-20 sm:py-28">
          <div className="mx-auto grid max-w-[1240px] gap-14 px-5 sm:px-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-center lg:gap-20">
            <div>
              <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${useCase.accent}`}>
                Das Problem im Alltag
              </p>
              <h2 className="mt-4 text-[40px] font-semibold leading-[1.02] tracking-[-0.055em] sm:text-[56px]">
                Weniger Nachtragen. Mehr verlässliche Antworten.
              </h2>
              <p className="mt-6 text-[16px] leading-7 text-muted">
                {useCase.challenge}
              </p>
              <ul className="mt-8 grid gap-3">
                {useCase.promises.map((promise) => (
                  <li
                    key={promise}
                    className="flex items-start gap-3 text-sm leading-6 text-muted-strong"
                  >
                    <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${useCase.softAccent}`}>
                      <Check className="size-3" strokeWidth={2.5} />
                    </span>
                    {promise}
                  </li>
                ))}
              </ul>
            </div>

            <MockInventory useCase={useCase} />
          </div>
        </section>

        <section className="border-y border-border bg-surface-subtle py-20 sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="max-w-3xl">
              <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${useCase.accent}`}>
                Ein Ablauf, der im Moment funktioniert
              </p>
              <h2 className="mt-4 text-[42px] font-semibold leading-[0.98] tracking-[-0.055em] sm:text-[60px]">
                Vom Gegenstand zum brauchbaren Inventar.
              </h2>
              <p className="mt-5 text-[16px] leading-7 text-muted sm:text-[18px]">
                Open Inventory beginnt bewusst bei Kamera und Code. Tiefe
                Funktionen kommen dazu, ohne die erste Erfassung auszubremsen.
              </p>
            </div>

            <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {useCase.steps.map((step, index) => (
                <article
                  key={step.title}
                  className="relative overflow-hidden rounded-[24px] border border-border bg-surface p-6"
                >
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand">
                    0{index + 1}
                  </span>
                  <h3 className="mt-10 text-xl font-semibold tracking-[-0.035em]">
                    {step.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-muted">
                    {step.description}
                  </p>
                  {index < useCase.steps.length - 1 ? (
                    <ArrowRight className="absolute right-5 top-5 hidden size-4 text-border-strong lg:block" />
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
              <div>
                <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${useCase.accent}`}>
                  Passende Funktionen
                </p>
                <h2 className="mt-4 text-[42px] font-semibold leading-[0.98] tracking-[-0.055em] sm:text-[60px]">
                  Alles erklärt, nichts versteckt.
                </h2>
              </div>
              <p className="max-w-2xl text-[16px] leading-7 text-muted lg:justify-self-end">
                Diese Bausteine greifen für {useCase.name} besonders gut
                ineinander. Sie sind Teil derselben Open-Source-Anwendung und
                werden nicht auf getrennte Branchenpakete verteilt.
              </p>
            </div>

            <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {useCase.features.map((feature) => {
                const Icon = featureIcons[feature.icon];
                return (
                  <article
                    key={feature.title}
                    className="group rounded-[26px] border border-border bg-surface p-6 transition duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-md)] sm:p-7"
                  >
                    <span className={`grid size-11 place-items-center rounded-2xl ${useCase.softAccent}`}>
                      <Icon className="size-5" strokeWidth={1.9} />
                    </span>
                    <h3 className="mt-10 text-[22px] font-semibold tracking-[-0.04em]">
                      {feature.title}
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-muted">
                      {feature.description}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="overflow-hidden bg-[#121318] py-20 text-white sm:py-28">
          <div className="mx-auto grid max-w-[1120px] gap-16 px-5 sm:px-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
            <div className="relative order-2 lg:order-1">
              <div className="pointer-events-none absolute left-1/2 top-1/2 size-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8175ff]/25 blur-[100px]" />
              <IosPhone useCase={useCase} />
            </div>
            <div className="order-1 lg:order-2">
              <div className="flex items-center gap-3">
                <Image
                  src="/marketing/ios-app-icon-current.png"
                  width={48}
                  height={48}
                  alt="Open Inventory App-Icon"
                  className="rounded-[13px] shadow-lg"
                />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8ff0cc]">
                    Native iOS-App
                  </p>
                  <p className="mt-1 text-xs text-white/45">SwiftUI · im Repository enthalten</p>
                </div>
              </div>
              <h2 className="mt-7 text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] sm:text-[62px]">
                {useCase.iosTitle}
              </h2>
              <p className="mt-6 text-[16px] leading-7 text-white/55 sm:text-[18px] sm:leading-8">
                {useCase.iosCopy}
              </p>
              <ul className="mt-8 grid gap-3">
                {useCase.iosPoints.map((point) => (
                  <li key={point} className="flex items-start gap-3 text-sm leading-6 text-white/70">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#8ff0cc]/15 text-[#8ff0cc]">
                      <Check className="size-3" />
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
              <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-semibold text-white/50">
                <CircleDot className="size-3 text-[#8ff0cc]" />
                Kamera und Scanner werden auf einem echten iPhone genutzt
              </div>
            </div>
          </div>
        </section>

        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="relative overflow-hidden rounded-[32px] border border-brand-border bg-brand-soft px-6 py-12 sm:px-12 sm:py-16 lg:px-16">
              <div className="pointer-events-none absolute -right-20 -top-24 size-80 rounded-full bg-brand/10 blur-[90px]" />
              <div className="relative grid gap-10 lg:grid-cols-[1fr_0.82fr] lg:items-center">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                    Open Source ist ein Produktmerkmal
                  </p>
                  <h2 className="mt-4 text-[40px] font-semibold leading-[1.02] tracking-[-0.055em] sm:text-[58px]">
                    {useCase.openSourceTitle}
                  </h2>
                  <p className="mt-6 max-w-3xl text-[16px] leading-7 text-muted-strong">
                    {useCase.openSourceCopy}
                  </p>
                </div>
                <div className="grid gap-3 rounded-[24px] border border-brand-border bg-surface/65 p-5 backdrop-blur sm:p-6">
                  {[
                    [Github, "MIT-lizenzierter Quellcode"],
                    [Container, "Docker-Setup mit PostgreSQL"],
                    [Braces, "Dokumentierte OpenAPI"],
                    [Smartphone, "Native iOS-App inklusive"],
                  ].map(([Icon, label]) => {
                    const ItemIcon = Icon as LucideIcon;
                    return (
                      <div key={label as string} className="flex items-center gap-3 text-sm font-semibold">
                        <span className="grid size-9 place-items-center rounded-xl bg-brand-solid text-on-brand">
                          <ItemIcon className="size-4" />
                        </span>
                        {label as string}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-border bg-surface-subtle py-20 sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
              <div className="max-w-3xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                  In deiner Infrastruktur starten
                </p>
                <h2 className="mt-4 text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] sm:text-[64px]">
                  Heute ein Foto. Morgen ein verlässliches Inventar.
                </h2>
                <p className="mt-5 text-[16px] leading-7 text-muted">
                  Docker starten, erstes Objekt fotografieren, Vorschlag prüfen.
                  So fühlt sich Inventarisieren in Sekunden statt Stunden an.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                <Link
                  href="/docs#docker"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-brand-solid px-5 text-sm font-semibold text-on-brand transition hover:-translate-y-0.5 hover:bg-brand-hover"
                >
                  <Container className="size-4" />
                  Docker-Anleitung öffnen
                </Link>
                <Link
                  href={`/use-cases/${nextUseCase.slug}`}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] border border-border bg-surface px-5 text-sm font-semibold transition hover:-translate-y-0.5 hover:border-border-strong"
                >
                  Nächster Use Case: {nextUseCase.name}
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
