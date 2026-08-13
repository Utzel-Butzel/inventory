import type { Metadata } from "next";
import Image from "next/image";
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
  title: { absolute: "Technische Notizen — Open Inventory" },
  description:
    "Technische Notizen zu Batch-Erfassung, Bestandsmodell, QR-Etiketten, Self-Hosting und der nativen iOS-App von Open Inventory.",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: "Technische Notizen — Open Inventory",
    description:
      "Implementierung, Datenmodell und Betrieb des MIT-lizenzierten Open-Source-Projekts.",
    type: "website",
    images: [
      {
        url: articles[0].cover.src,
        width: articles[0].cover.width,
        height: articles[0].cover.height,
        alt: articles[0].cover.alt,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Technische Notizen — Open Inventory",
    description:
      "Implementierung, Datenmodell und Betrieb des MIT-lizenzierten Open-Source-Projekts.",
    images: [articles[0].cover.src],
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
                Technische Notizen
              </p>
              <h1 className="mt-5 text-[clamp(3.2rem,7vw,6.6rem)] font-semibold leading-[0.91] tracking-[-0.07em]">
                Wie Open Inventory
                <span className="block text-[#9188ff]">intern funktioniert.</span>
              </h1>
              <p className="mt-7 max-w-2xl text-[17px] leading-8 text-white/55 sm:text-[19px]">
                Notizen zu Queues, Datenmodell, API, Etiketten, iOS und
                Self-Hosting. Mit konkreten Grenzen und Links zum offenen
                Quellcode.
              </p>
            </div>

            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-xs font-semibold text-white/60">
              {[
                "MIT-Lizenz",
                "PostgreSQL + Next.js",
                "SwiftUI + RoomPlan",
                "OpenAPI",
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
            Aktueller Artikel
          </p>

          <Link
            href={`/blog/${featured.slug}`}
            className="group mt-5 grid overflow-hidden rounded-[30px] border border-border bg-surface shadow-sm transition duration-300 hover:-translate-y-1 hover:border-border-strong hover:shadow-xl lg:grid-cols-[0.9fr_1.1fr]"
          >
            <div className="relative min-h-[300px] overflow-hidden bg-strong text-white lg:min-h-[440px]">
              <Image
                src={featured.cover.src}
                alt={featured.cover.alt}
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 500px"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/5 to-black/10" />
              <div className="absolute inset-x-6 bottom-6 flex items-end justify-between gap-4 sm:inset-x-8 sm:bottom-8">
                <span className="rounded-full border border-white/25 bg-black/35 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] backdrop-blur-sm">
                  {featured.category}
                </span>
                <span className="text-[10px] text-white/70">Illustratives Bild</span>
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
                Zum Artikel
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
                  Erfassung, Datenmodell und Betrieb
                </h2>
              </div>
              <p className="max-w-md text-sm leading-6 text-muted">
                Implementierungsdetails, technische Entscheidungen und bekannte
                Grenzen aus dem offenen Repository.
              </p>
            </div>

            <div className="mt-10 grid gap-5 md:grid-cols-2">
              {moreArticles.map((article) => (
                <Link
                  key={article.slug}
                  href={`/blog/${article.slug}`}
                  className="group flex min-h-[420px] flex-col overflow-hidden rounded-[26px] border border-border bg-surface shadow-sm transition duration-300 hover:-translate-y-1 hover:border-border-strong hover:shadow-lg"
                >
                  <div className="relative aspect-[16/10] overflow-hidden bg-surface-muted">
                    <Image
                      src={article.cover.src}
                      alt={article.cover.alt}
                      fill
                      sizes="(max-width: 768px) 100vw, 50vw"
                      className="object-cover transition duration-500 group-hover:scale-[1.02]"
                    />
                  </div>
                  <div className="flex flex-1 flex-col p-7 sm:p-8">
                    <div className="flex items-center justify-between gap-4">
                      <span className={`rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${article.accentSoft}`}>
                        {article.category}
                      </span>
                      <span className={`size-3 rounded-full bg-gradient-to-br ${article.accent}`} />
                    </div>
                    <h3 className="mt-7 text-[28px] font-semibold leading-[1.05] tracking-[-0.045em] text-foreground sm:text-[32px]">
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
                title: "Batch-Erfassung",
                copy: "Gemeinsame Felder werden einmal gesetzt. Upload, Analyse und Cover laufen als getrennte, idempotente Queue-Stufen.",
              },
              {
                icon: LockKeyhole,
                title: "Docker-Betrieb",
                copy: "Next.js, PostgreSQL und Upload-Speicher selbst betreiben. Backups, TLS und Updates bleiben Betriebsaufgaben.",
              },
              {
                icon: BookOpenText,
                title: "Code und API",
                copy: "Repository, Migrationen und OpenAPI-Spezifikation sind offen einsehbar. Der Code steht unter der MIT-Lizenz.",
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
                Repository, Lizenz und Issues
              </h2>
            </div>
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-[#121318] transition hover:-translate-y-0.5"
            >
              <Github className="size-4" aria-hidden="true" />
              Repository öffnen
            </a>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
