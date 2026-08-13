import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  Check,
  Github,
  LockKeyhole,
  TimerReset,
} from "lucide-react";

import {
  MarketingFooter,
  MarketingHeader,
} from "@/components/marketing/site-chrome";

import { articles, githubUrl } from "./articles";

export const metadata: Metadata = {
  title: { absolute: "Blog — Open Inventory" },
  description:
    "Praxiswissen zu schneller Inventarisierung, Mengen- und Serienbestand, QR-Etiketten, Self-Hosting und der nativen iOS-App von Open Inventory.",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: "Blog — Open Inventory",
    description:
      "Konkrete Workflows für ein schnelles, offenes und selbst gehostetes Inventar.",
    type: "website",
  },
};

export default function BlogPage() {
  const [featured, ...moreArticles] = articles;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <MarketingHeader />

      <main>
        <section className="relative overflow-hidden border-b border-border bg-[#121318] text-white">
          <div className="pointer-events-none absolute left-[8%] top-16 size-[360px] rounded-full bg-[#8ff0cc]/10 blur-[110px]" />
          <div className="pointer-events-none absolute right-[7%] top-4 size-[480px] rounded-full bg-[#665cff]/25 blur-[140px]" />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:linear-gradient(to_bottom,black,transparent_90%)]" />

          <div className="relative mx-auto max-w-[1240px] px-5 py-20 sm:px-8 sm:py-28">
            <div className="max-w-4xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8ff0cc]">
                Open Inventory Blog
              </p>
              <h1 className="mt-5 text-[clamp(3.2rem,7vw,6.6rem)] font-semibold leading-[0.91] tracking-[-0.07em]">
                Weniger Listen.
                <span className="block text-[#9188ff]">Mehr Überblick.</span>
              </h1>
              <p className="mt-7 max-w-2xl text-[17px] leading-8 text-white/55 sm:text-[19px]">
                Praktische Anleitungen für Inventarisierung in Sekunden statt
                Stunden – mit klaren Workflows, ehrlichen Grenzen und einem
                Open-Source-System unter MIT-Lizenz.
              </p>
            </div>

            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-xs font-semibold text-white/60">
              {[
                "Open Source",
                "Self-hosted",
                "Native iOS-App",
                "Keine erfundenen Benchmarks",
              ].map((item) => (
                <span key={item} className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#8ff0cc]" aria-hidden="true" />
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1240px] px-5 py-16 sm:px-8 sm:py-24">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
            Neu im Blog
          </p>

          <Link
            href={`/blog/${featured.slug}`}
            className="group mt-5 grid overflow-hidden rounded-[30px] border border-border bg-surface shadow-sm transition duration-300 hover:-translate-y-1 hover:border-border-strong hover:shadow-xl lg:grid-cols-[0.9fr_1.1fr]"
          >
            <div
              className={`relative min-h-[300px] overflow-hidden bg-gradient-to-br ${featured.accent} p-8 text-white sm:p-10 lg:min-h-[440px]`}
            >
              <div className="absolute -right-20 -top-16 size-64 rounded-full border border-white/20" />
              <div className="absolute -right-6 -top-4 size-64 rounded-full border border-white/15" />
              <div className="absolute bottom-10 left-10 right-10 h-px bg-white/25" />
              <div className="relative flex h-full flex-col justify-between">
                <span className="w-fit rounded-full border border-white/25 bg-black/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] backdrop-blur-sm">
                  {featured.category}
                </span>
                <div className="mt-20">
                  <TimerReset className="size-12 opacity-85" strokeWidth={1.5} />
                  <p className="mt-5 max-w-sm text-lg font-semibold leading-7 tracking-[-0.025em]">
                    {featured.heroLabel}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col justify-center p-8 sm:p-12 lg:p-14">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-muted">
                <time dateTime={featured.publishedAt}>{featured.publishedLabel}</time>
                <span aria-hidden="true">·</span>
                <span>{featured.readingTime}</span>
              </div>
              <h2 className="mt-5 text-[clamp(2rem,4vw,3.7rem)] font-semibold leading-[0.98] tracking-[-0.055em] text-foreground">
                {featured.title}
              </h2>
              <p className="mt-6 max-w-xl text-[15px] leading-7 text-muted sm:text-base">
                {featured.excerpt}
              </p>
              <span className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-brand">
                Artikel lesen
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </span>
            </div>
          </Link>
        </section>

        <section className="border-y border-border bg-surface-subtle">
          <div className="mx-auto max-w-[1240px] px-5 py-16 sm:px-8 sm:py-24">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                  Alle Artikel
                </p>
                <h2 className="mt-3 text-[34px] font-semibold tracking-[-0.05em] text-foreground sm:text-[44px]">
                  Vom ersten Foto bis zum Betrieb.
                </h2>
              </div>
              <p className="max-w-md text-sm leading-6 text-muted">
                Konkrete Entscheidungen für Menschen, die Dinge wirklich
                erfassen, finden und gemeinsam nutzen.
              </p>
            </div>

            <div className="mt-10 grid gap-5 md:grid-cols-2">
              {moreArticles.map((article) => (
                <Link
                  key={article.slug}
                  href={`/blog/${article.slug}`}
                  className="group flex min-h-[330px] flex-col rounded-[26px] border border-border bg-surface p-7 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-border-strong hover:shadow-lg sm:p-8"
                >
                  <div className="flex items-center justify-between gap-4">
                    <span className={`rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${article.accentSoft}`}>
                      {article.category}
                    </span>
                    <span className={`size-3 rounded-full bg-gradient-to-br ${article.accent}`} />
                  </div>
                  <h3 className="mt-10 text-[28px] font-semibold leading-[1.05] tracking-[-0.045em] text-foreground sm:text-[32px]">
                    {article.title}
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-muted">
                    {article.excerpt}
                  </p>
                  <div className="mt-auto flex items-end justify-between gap-4 pt-8">
                    <span className="text-[11px] font-medium text-muted">
                      {article.publishedLabel} · {article.readingTime}
                    </span>
                    <span className="grid size-10 shrink-0 place-items-center rounded-full border border-border text-foreground transition group-hover:border-brand group-hover:bg-brand-solid group-hover:text-on-brand">
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1240px] px-5 py-20 sm:px-8 sm:py-28">
          <div className="grid gap-5 md:grid-cols-3">
            {[
              {
                icon: TimerReset,
                title: "Schnell anfangen",
                copy: "Kurze Erfassungsschritte, Hintergrundverarbeitung und gemeinsame Vorgaben statt Formular-Marathon.",
              },
              {
                icon: LockKeyhole,
                title: "Selbst betreiben",
                copy: "Anwendung, Datenbank und Uploads auf der Infrastruktur betreiben, die zu deinen Anforderungen passt.",
              },
              {
                icon: BookOpenText,
                title: "Offen verstehen",
                copy: "Quellcode, API und Datenmodell sind nachvollziehbar. Open Inventory steht unter der MIT-Lizenz.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-border bg-surface p-6">
                <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
                  <item.icon className="size-[18px]" aria-hidden="true" />
                </span>
                <h2 className="mt-5 text-lg font-semibold tracking-[-0.025em] text-foreground">
                  {item.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted">{item.copy}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-start justify-between gap-6 rounded-[26px] bg-[#121318] p-7 text-white sm:flex-row sm:items-center sm:p-9">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8ff0cc]">
                Open Source · MIT
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">
                Nicht nur darüber lesen. Den Code ansehen.
              </h2>
            </div>
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-[#121318] transition hover:-translate-y-0.5"
            >
              <Github className="size-4" aria-hidden="true" />
              GitHub öffnen
            </a>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
