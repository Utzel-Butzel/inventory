import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Barcode,
  Boxes,
  Camera,
  Check,
  CircleDot,
  Container,
  Database,
  Github,
  MapPinned,
  PackageCheck,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Tags,
  WandSparkles,
} from "lucide-react";

import { HeroVideo } from "@/components/marketing/hero-video";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";

const githubUrl = "https://github.com/Utzel-Butzel/inventory";

export const metadata: Metadata = {
  title: { absolute: "Open Inventory — Inventarisieren in Sekunden statt Stunden" },
  description:
    "Foto aufnehmen, KI-Vorschlag prüfen, speichern. Open Inventory ist eine schnelle, selbst hostbare und MIT-lizenzierte Inventarlösung mit nativer iOS-App.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Open Inventory — Inventarisieren in Sekunden statt Stunden",
    description:
      "Foto aufnehmen, Vorschlag prüfen, speichern. Open Source, self-hosted und mit nativer iOS-App.",
  },
};

const flow = [
  {
    number: "01",
    icon: Camera,
    title: "Fotografieren",
    copy: "Ein Objekt oder gleich eine ganze Serie aufnehmen. Nach jedem Absenden ist die Kamera direkt wieder frei.",
  },
  {
    number: "02",
    icon: WandSparkles,
    title: "Vorschlag prüfen",
    copy: "Die KI schlägt Name, Beschreibung, Typ, Tags und Alt-Text vor. Du entscheidest, was gespeichert wird.",
  },
  {
    number: "03",
    icon: ScanLine,
    title: "Sofort wiederfinden",
    copy: "Über Suche, QR-Code, Standort, Kategorie oder die native iOS-App landet alles wieder in deiner Hand.",
  },
];

const useCases = [
  {
    slug: "makerspace",
    image: "/marketing/usecase-makerspace-v2.webp",
    label: "Makerspace",
    title: "Werkzeuge finden. Ausleihen nachvollziehen.",
    copy: "Maschinen serialisieren, Verbrauchsmaterial im Blick behalten und QR-Etiketten direkt am Regal nutzen.",
  },
  {
    slug: "familie",
    image: "/marketing/usecase-family-v2.webp",
    label: "Familie",
    title: "Wissen, was ihr habt – und wo es liegt.",
    copy: "Kisten, Keller, Dachboden und Garantien gemeinsam ordnen, ohne eine Tabellenpflege daraus zu machen.",
  },
  {
    slug: "startup",
    image: "/marketing/usecase-startup-v2.webp",
    label: "Startup",
    title: "Assets und Teile ohne Tabellenchaos.",
    copy: "Geräte zuweisen, Prototypteile zählen, Wareneingänge buchen und Abläufe über die offene API verbinden.",
  },
];

const featureGroups = [
  {
    icon: WandSparkles,
    title: "Schnellerfassung & KI",
    copy: "Serienerfassung, Bildanalyse, Titelbilder, Fotozählung, Duplikate und prüfbare Übersetzungen.",
  },
  {
    icon: Boxes,
    title: "Inventar & Medien",
    copy: "Suche, Typen, eigene Felder, Beziehungen, Bilder, Videos, PDFs und öffentliche Leselinks.",
  },
  {
    icon: PackageCheck,
    title: "Bestand & Abläufe",
    copy: "Bulk und serialisiert, Bewegungen, Lagerorte, Ausleihen, Bestellungen, Stücklisten und Forecasts.",
  },
  {
    icon: Barcode,
    title: "Etiketten & Austausch",
    copy: "QR und Code 128, visueller Labeldesigner, sichere Kurzlinks sowie geprüfter CSV-Import und -Export.",
  },
  {
    icon: MapPinned,
    title: "Karte & 3D-Räume",
    copy: "Punkte, Polygone, Raumstrukturen und optionale LiDAR-/RoomPlan-Erfassung mit dem iPhone.",
  },
  {
    icon: ShieldCheck,
    title: "Team & Integration",
    copy: "Eigene Rollen, bedingte Rechte, Sharing, API-Token, OpenAPI, Docker und PostgreSQL.",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <MarketingHeader />

      <main>
        <section className="relative overflow-hidden border-b border-border">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:56px_56px] opacity-55 [mask-image:linear-gradient(to_bottom,black,transparent_86%)]" />
          <div className="pointer-events-none absolute left-[2%] top-24 size-[340px] rounded-full bg-[#8ff0cc]/30 blur-[110px]" />
          <div className="pointer-events-none absolute right-[2%] top-16 size-[430px] rounded-full bg-[#8175ff]/20 blur-[130px]" />

          <div className="relative mx-auto max-w-[980px] px-5 pb-20 pt-14 text-center sm:px-8 sm:pb-28 sm:pt-20 lg:pt-24">
            <div className="relative z-10 mx-auto max-w-[820px] animate-fade-up">
                <span className="inline-flex items-center gap-2 rounded-full border border-brand-border bg-brand-soft px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-brand">
                  <Github className="size-3.5" />
                  MIT Open Source · Self-hosted
                </span>

                <h1 className="mt-6 text-[clamp(3.35rem,6.5vw,6.5rem)] font-semibold leading-[0.9] tracking-[-0.075em] text-foreground">
                  Inventarisieren
                  <span className="block text-brand">in Sekunden.</span>
                </h1>
                <p className="mx-auto mt-6 max-w-[590px] text-[20px] font-medium leading-8 tracking-[-0.02em] text-foreground/80 sm:text-[23px]">
                  Statt Stunden mit Tabellen zu verlieren.
                </p>
                <p className="mx-auto mt-3 max-w-[570px] text-[16px] leading-7 text-muted sm:text-[18px] sm:leading-8">
                  Foto aufnehmen, KI-Vorschlag prüfen, speichern. Open Inventory
                  macht Gegenstände schnell strukturiert, durchsuchbar und im
                  Alltag wirklich nutzbar.
                </p>

                <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                  <Link href="/docs#docker" className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-brand-solid px-5 text-sm font-semibold text-on-brand shadow-[0_12px_30px_rgba(102,92,255,0.25)] transition hover:-translate-y-0.5 hover:bg-brand-hover">
                    <Container className="size-[17px]" />
                    Mit Docker starten
                  </Link>
                  <a href={githubUrl} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] border border-border bg-surface/80 px-5 text-sm font-semibold text-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface">
                    <Github className="size-[17px]" />
                    Quellcode ansehen
                  </a>
                </div>

                <div className="mt-7 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[11px] font-semibold text-muted">
                  {["MIT-lizenziert", "Eigene Infrastruktur", "Native iOS-App", "Offene REST API"].map((item) => (
                    <span key={item} className="flex items-center gap-1.5">
                      <Check className="size-3 text-success" strokeWidth={2.5} />
                      {item}
                    </span>
                  ))}
                </div>
            </div>
          </div>
        </section>

        <section className="bg-surface py-20 sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">So einfach geht es</p>
              <h2 className="mt-4 text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] sm:text-[62px]">
                Ein Foto. Ein prüfbarer Eintrag.
              </h2>
              <p className="mt-5 max-w-2xl text-[16px] leading-7 text-muted">
                Die Automatisierung arbeitet im Hintergrund. Die Entscheidung
                bleibt bei dir – ohne Formulare auszufüllen, bevor du überhaupt
                anfangen kannst.
              </p>
            </div>

            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              {flow.map((step) => {
                const Icon = step.icon;
                return (
                  <article key={step.title} className="group rounded-[26px] border border-border bg-background p-6 transition duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-md)] sm:p-8">
                    <div className="flex items-center justify-between">
                      <span className="grid size-11 place-items-center rounded-2xl bg-brand-soft text-brand"><Icon className="size-5" /></span>
                      <span className="font-mono text-[10px] text-muted">{step.number}</span>
                    </div>
                    <h3 className="mt-12 text-[26px] font-semibold tracking-[-0.045em]">{step.title}</h3>
                    <p className="mt-3 text-[15px] leading-6 text-muted">{step.copy}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <HeroVideo />

        <section className="overflow-hidden bg-[#121318] py-20 text-white sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ff0cc]">Echte Oberfläche · Beispieldaten</p>
                <h2 className="mt-4 text-[44px] font-semibold leading-[0.96] tracking-[-0.06em] sm:text-[62px]">Alles sichtbar. Nichts abstrakt.</h2>
              </div>
              <p className="max-w-lg text-[16px] leading-7 text-white/60 lg:justify-self-end">
                Vier Demo-Einträge, sieben Einheiten und konkrete Standorte zeigen,
                wie Open Inventory im Alltag aussieht – nicht nur in einer Feature-Liste.
              </p>
            </div>

            <div className="relative mt-12 overflow-hidden rounded-[28px] border border-white/10 bg-[#1b1c22] p-2 shadow-2xl sm:p-3">
              <span className="absolute right-5 top-5 z-10 rounded-full border border-white/15 bg-[#17181d]/90 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/70 backdrop-blur">Beispieldaten</span>
              <div className="overflow-hidden rounded-[20px] bg-[#f4f5f7]">
                <Image src="/marketing/dashboard-mock-data.jpg" width={1440} height={960} alt="Open Inventory Dashboard mit vier Demo-Einträgen, sieben Einheiten und 7.924 Euro Inventarwert" className="h-auto w-full" />
              </div>
            </div>
          </div>
        </section>

        <section className="bg-background py-20 sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-3xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">Für echte Inventare</p>
                <h2 className="mt-4 text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] sm:text-[60px]">Vom Keller bis zum Prototypenlabor.</h2>
              </div>
              <Link href="/use-cases" className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:text-brand-strong">Alle Use Cases <ArrowRight className="size-4" /></Link>
            </div>

            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              {useCases.map((item) => (
                <Link key={item.slug} href={`/use-cases/${item.slug}`} className="group overflow-hidden rounded-[26px] border border-border bg-surface transition duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-md)]">
                  <div className="relative aspect-[3/2] overflow-hidden bg-surface-muted">
                    <Image src={item.image} fill sizes="(max-width: 1024px) 100vw, 33vw" alt="" className="object-cover transition duration-500 group-hover:scale-[1.02]" />
                  </div>
                  <div className="p-6 sm:p-7">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand">{item.label}</p>
                    <h3 className="mt-3 text-[25px] font-semibold leading-[1.05] tracking-[-0.045em]">{item.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-muted">{item.copy}</p>
                    <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-foreground">Use Case ansehen <ArrowRight className="size-4 transition group-hover:translate-x-1" /></span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-surface py-20 sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr]">
              <div className="max-w-lg">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">Mehr als eine Liste</p>
                <h2 className="mt-4 text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] sm:text-[58px]">Alle Funktionen, verständlich erklärt.</h2>
                <p className="mt-5 text-[16px] leading-7 text-muted">
                  Von der ersten Aufnahme bis zur offenen API: Jede Funktion
                  löst einen konkreten Schritt im Inventaralltag.
                </p>
                <Link href="/features" className="mt-7 inline-flex h-11 items-center gap-2 rounded-xl bg-strong px-4 text-sm font-semibold text-on-strong">Alle Funktionen entdecken <ArrowRight className="size-4" /></Link>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {featureGroups.map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <article key={feature.title} className="rounded-2xl border border-border bg-background p-5">
                      <Icon className="size-5 text-brand" />
                      <h3 className="mt-5 text-base font-semibold tracking-[-0.025em]">{feature.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-muted">{feature.copy}</p>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden bg-background py-20 sm:py-28">
          <div className="mx-auto grid max-w-[1140px] gap-14 px-5 sm:px-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
            <div className="relative mx-auto w-full max-w-[390px] pb-8">
              <div className="absolute inset-10 rounded-full bg-brand-soft blur-[70px]" />
              <div className="relative overflow-hidden rounded-[42px] border border-border bg-surface-subtle p-3 shadow-[var(--shadow-md)]">
                <Image src="/marketing/ios-app-icon-current.png" width={1024} height={1024} alt="Aktuelles App-Icon der nativen Inventory iOS-App" className="h-auto w-full rounded-[31px]" />
              </div>
              <div className="absolute -bottom-1 -right-4 w-[220px] rounded-2xl border border-border bg-surface p-3.5 shadow-[var(--shadow-md)]">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-9 place-items-center rounded-xl bg-success-soft text-success"><CircleDot className="size-4" /></span>
                  <div><p className="text-[9px] font-semibold">Upload-Warteschlange</p><p className="mt-0.5 text-[8px] text-muted">gesichert · wiederholbar</p></div>
                </div>
              </div>
            </div>

            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-strong">
                <Smartphone className="size-3.5 text-brand" /> Native SwiftUI-App · Open Source
              </span>
              <h2 className="mt-5 max-w-2xl text-[44px] font-semibold leading-[0.97] tracking-[-0.06em] sm:text-[62px]">Inventar dort erfassen, wo es steht.</h2>
              <p className="mt-6 max-w-xl text-[16px] leading-7 text-muted">
                Fotografieren, QR und Barcodes scannen, suchen, bearbeiten,
                Bestände buchen und optional Räume mit LiDAR erfassen. Die
                native App verbindet sich mit deinem eigenen Server.
              </p>
              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {[
                  [Camera, "Bis zu 12 Fotos pro Erfassung"],
                  [Barcode, "QR, EAN, Code 128 und mehr"],
                  [PackageCheck, "Bestand direkt zu- oder abbuchen"],
                  [MapPinned, "Optional RoomPlan und LiDAR"],
                ].map(([Icon, text]) => {
                  const ItemIcon = Icon as typeof Camera;
                  return <div key={String(text)} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-sm font-medium text-muted-strong"><ItemIcon className="size-4 shrink-0 text-brand" />{String(text)}</div>;
                })}
              </div>
              <div className="mt-7 flex flex-wrap items-center gap-4">
                <Link href="/ios" className="inline-flex items-center gap-2 text-sm font-semibold text-brand">Die iOS-App kennenlernen <ArrowRight className="size-4" /></Link>
                <span className="text-xs text-muted">iOS 17+ · Einrichtung über Xcode · Quellcode im Repository</span>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-brand-solid px-5 py-8 sm:px-8 sm:py-12">
          <div className="relative mx-auto max-w-[1180px] overflow-hidden rounded-[30px] bg-[#17181d] px-6 py-16 text-white sm:px-12 sm:py-20">
            <div className="pointer-events-none absolute left-1/2 top-0 h-60 w-[620px] -translate-x-1/2 bg-[radial-gradient(ellipse_at_top,rgba(143,240,204,0.24),transparent_68%)]" />
            <div className="relative grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.07] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#8ff0cc]">
                  <Github className="size-3.5" /> MIT Open Source
                </span>
                <h2 className="mt-6 max-w-3xl text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] sm:text-[62px]">Dein Inventar. Deine Infrastruktur. Dein Code.</h2>
                <p className="mt-5 max-w-2xl text-[16px] leading-7 text-white/55">
                  Next.js, PostgreSQL, Docker, OpenAPI und die native iOS-App in
                  einem offenen Repository. Optionale KI- und Speicheranbieter
                  bestimmst du in deiner Installation.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                <Link href="/open-source" className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-[#8ff0cc] px-5 text-sm font-semibold text-[#17382d]">Warum Open Source? <ArrowRight className="size-4" /></Link>
                <a href={githubUrl} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] border border-white/15 bg-white/[0.06] px-5 text-sm font-semibold text-white"><Github className="size-4" />Auf GitHub ansehen</a>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-background py-20 sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">Aus dem Blog</p>
                <h2 className="mt-4 text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] sm:text-[58px]">Inventar, praktisch gedacht.</h2>
              </div>
              <Link href="/blog" className="inline-flex items-center gap-2 text-sm font-semibold text-brand">Alle Beiträge <ArrowRight className="size-4" /></Link>
            </div>
            <div className="mt-10 grid gap-4 lg:grid-cols-3">
              {[
                { icon: Camera, title: "Vom Foto zum Eintrag", copy: "Wie Serienerfassung und prüfbare KI-Vorschläge zusammenspielen.", href: "/blog/serienerfassung-in-sekunden" },
                { icon: Tags, title: "Bulk oder serialisiert?", copy: "Welches Bestandsmodell für Verbrauchsteile, Werkzeuge und Geräte passt.", href: "/blog/mengenbestand-oder-serialisiert" },
                { icon: Database, title: "Warum selbst hosten?", copy: "Was offene Software und die eigene Infrastruktur bei Inventardaten bedeuten.", href: "/blog/warum-inventar-selbst-hosten" },
              ].map((article) => {
                const Icon = article.icon;
                return (
                  <Link key={article.href} href={article.href} className="group rounded-[24px] border border-border bg-surface p-6 transition hover:-translate-y-1 hover:shadow-[var(--shadow-md)]">
                    <Icon className="size-5 text-brand" />
                    <h3 className="mt-12 text-[24px] font-semibold tracking-[-0.04em]">{article.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-muted">{article.copy}</p>
                    <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold">Weiterlesen <ArrowRight className="size-4 transition group-hover:translate-x-1" /></span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        <section className="border-t border-border bg-surface px-5 py-16 sm:px-8 sm:py-20">
          <div className="mx-auto max-w-[960px] text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">Offen anfangen. Schnell weitermachen.</p>
            <h2 className="mt-4 text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] sm:text-[62px]">Das nächste Objekt ist in Sekunden erfasst.</h2>
            <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-7 text-muted">Open Inventory ist MIT-lizenziert, selbst hostbar und ohne künstliche Produktgrenzen offen für deinen Workflow.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/docs#docker" className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-brand-solid px-5 text-sm font-semibold text-on-brand"><Container className="size-4" />Mit Docker starten</Link>
              <Link href="/features" className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] border border-border bg-background px-5 text-sm font-semibold">Alle Funktionen <ArrowRight className="size-4" /></Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
