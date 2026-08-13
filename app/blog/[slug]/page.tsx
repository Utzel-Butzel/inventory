import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  Github,
  Info,
  Lightbulb,
  TriangleAlert,
} from "lucide-react";

import {
  MarketingFooter,
  MarketingHeader,
} from "@/components/marketing/site-chrome";

import { articles, getArticle, githubUrl } from "../articles";

type ArticlePageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return articles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({
  params,
}: ArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);

  if (!article) return {};

  return {
    title: { absolute: `${article.title} — Open Inventory` },
    description: article.description,
    alternates: { canonical: `/blog/${article.slug}` },
    openGraph: {
      title: article.title,
      description: article.description,
      type: "article",
      publishedTime: article.publishedAt,
      authors: ["Open Inventory"],
      images: [
        {
          url: article.cover.src,
          width: article.cover.width,
          height: article.cover.height,
          alt: article.cover.alt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: article.title,
      description: article.description,
      images: [article.cover.src],
    },
  };
}

function Note({
  note,
}: {
  note: NonNullable<(typeof articles)[number]["sections"][number]["note"]>;
}) {
  const styles = {
    brand: {
      wrapper: "border-brand/20 bg-brand-soft",
      icon: "bg-brand-solid text-on-brand",
      Icon: Info,
    },
    warning: {
      wrapper: "border-warning/25 bg-warning-soft",
      icon: "bg-warning text-white",
      Icon: TriangleAlert,
    },
    success: {
      wrapper: "border-success/25 bg-success-soft",
      icon: "bg-success text-white",
      Icon: Lightbulb,
    },
  } as const;
  const style = styles[note.tone ?? "brand"];
  const Icon = style.Icon;

  return (
    <aside className={`mt-8 rounded-2xl border p-5 sm:p-6 ${style.wrapper}`}>
      <div className="flex items-start gap-4">
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${style.icon}`}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">{note.title}</p>
          <p className="mt-1.5 text-sm leading-6 text-muted-strong">
            <InlineCode text={note.body} />
          </p>
        </div>
      </div>
    </aside>
  );
}

function InlineCode({ text }: { text: string }) {
  return text.split(/(`[^`]+`)/g).map((part, index) =>
    part.startsWith("`") && part.endsWith("`") ? (
      <code
        key={`${part}-${index}`}
        className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[0.88em] text-foreground"
      >
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const article = getArticle(slug);

  if (!article) notFound();

  const articleIndex = articles.findIndex((item) => item.slug === article.slug);
  const nextArticle = articles[(articleIndex + 1) % articles.length];

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <MarketingHeader />

      <main>
        <article>
          <header className="relative overflow-hidden border-b border-white/10 bg-[#121318] text-white">
            <div className={`pointer-events-none absolute -right-24 -top-36 size-[620px] rounded-full bg-gradient-to-br ${article.accent} opacity-25 blur-[110px]`} />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:linear-gradient(to_bottom,black,transparent_92%)]" />

            <div className="relative mx-auto max-w-[1020px] px-5 pb-16 pt-12 sm:px-8 sm:pb-24 sm:pt-16">
              <Link
                href="/blog"
                className="inline-flex items-center gap-2 text-xs font-semibold text-white/55 transition hover:text-white"
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                Alle Artikel
              </Link>

              <div className="mt-12 flex flex-wrap items-center gap-3 text-[11px] font-semibold text-white/50">
                <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 uppercase tracking-[0.15em] text-[#8ff0cc]">
                  {article.category}
                </span>
                <time dateTime={article.publishedAt}>{article.publishedLabel}</time>
                <span aria-hidden="true">·</span>
                <span>{article.readingTime}</span>
              </div>

              <h1 className="mt-7 max-w-5xl text-[clamp(3rem,7vw,6rem)] font-semibold leading-[0.93] tracking-[-0.065em]">
                {article.title}
              </h1>
              <p className="mt-7 max-w-3xl text-[17px] leading-8 text-white/55 sm:text-[19px]">
                {article.excerpt}
              </p>

              <div className="mt-10 flex items-center gap-3 border-t border-white/10 pt-6">
                <span className={`grid size-9 place-items-center rounded-xl bg-gradient-to-br ${article.accent} text-xs font-bold text-white`}>
                  OI
                </span>
                <div>
                  <p className="text-xs font-semibold text-white">Open Inventory</p>
                  <p className="mt-0.5 text-[11px] text-white/45">Technische Notizen · MIT-lizenziert</p>
                </div>
              </div>
            </div>
          </header>

          <figure className="mx-auto max-w-[1120px] px-5 pt-10 sm:px-8 sm:pt-12">
            <div className="relative aspect-[3/2] overflow-hidden rounded-[24px] border border-border bg-surface-muted shadow-sm">
              <Image
                src={article.cover.src}
                alt={article.cover.alt}
                fill
                sizes="(max-width: 1120px) 100vw, 1056px"
                className="object-cover"
              />
            </div>
            <figcaption className="mt-3 text-xs leading-5 text-muted">
              {article.cover.caption}
            </figcaption>
          </figure>

          <div className="mx-auto grid max-w-[1120px] gap-12 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[220px_minmax(0,760px)] lg:justify-between">
            <aside className="hidden lg:block">
              <div className="sticky top-24">
                <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                  In diesem Artikel
                </p>
                <nav className="mt-3 grid gap-1" aria-label="Inhaltsverzeichnis">
                  {article.sections.map((section) => (
                    <Link
                      key={section.id}
                      href={`#${section.id}`}
                      className="rounded-xl px-3 py-2.5 text-[12px] font-medium leading-5 text-muted transition hover:bg-surface hover:text-foreground"
                    >
                      {section.title}
                    </Link>
                  ))}
                </nav>
                <div className="mt-7 border-t border-border px-3 pt-6">
                  <a
                    href={githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-xs font-semibold text-brand hover:text-brand-strong"
                  >
                    <Github className="size-3.5" aria-hidden="true" />
                    GitHub
                  </a>
                </div>
              </div>
            </aside>

            <div className="min-w-0">
              <section className="rounded-[24px] border border-border bg-surface p-6 shadow-sm sm:p-8">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">
                  Kurz zusammengefasst
                </p>
                <ul className="mt-5 grid gap-4">
                  {article.takeaways.map((takeaway) => (
                    <li key={takeaway} className="flex items-start gap-3 text-sm leading-6 text-muted-strong">
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-success-soft text-success">
                        <Check className="size-3" strokeWidth={2.5} aria-hidden="true" />
                      </span>
                      <InlineCode text={takeaway} />
                    </li>
                  ))}
                </ul>
              </section>

              <div className="mt-4">
                {article.sections.map((section, sectionIndex) => (
                  <section
                    key={section.id}
                    id={section.id}
                    className="scroll-mt-28 border-b border-border py-14 last:border-0 sm:py-16"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`grid size-8 place-items-center rounded-xl bg-gradient-to-br text-[11px] font-semibold text-white ${article.accent}`}>
                        {String(sectionIndex + 1).padStart(2, "0")}
                      </span>
                      {section.eyebrow ? (
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">
                          {section.eyebrow}
                        </p>
                      ) : null}
                    </div>

                    <h2 className="mt-5 text-[32px] font-semibold leading-[1.05] tracking-[-0.05em] text-foreground sm:text-[42px]">
                      {section.title}
                    </h2>

                    {section.paragraphs ? (
                      <div className="mt-7 space-y-5 text-[15px] leading-7 text-muted-strong sm:text-base sm:leading-8">
                        {section.paragraphs.map((paragraph) => (
                          <p key={paragraph}>
                            <InlineCode text={paragraph} />
                          </p>
                        ))}
                      </div>
                    ) : null}

                    {section.steps ? (
                      <ol className="mt-8 grid gap-4">
                        {section.steps.map((step, index) => (
                          <li key={step.title} className="grid gap-4 rounded-2xl border border-border bg-surface p-5 sm:grid-cols-[40px_1fr] sm:p-6">
                            <span className="grid size-10 place-items-center rounded-xl bg-strong font-mono text-xs font-semibold text-on-strong">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <div>
                              <h3 className="text-base font-semibold tracking-[-0.02em] text-foreground">
                                <InlineCode text={step.title} />
                              </h3>
                              <p className="mt-2 text-sm leading-6 text-muted">
                                <InlineCode text={step.body} />
                              </p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : null}

                    {section.bullets ? (
                      <ul className="mt-8 grid gap-3">
                        {section.bullets.map((bullet) => (
                          <li key={bullet} className="flex items-start gap-3 rounded-xl bg-surface-subtle px-4 py-3.5 text-sm leading-6 text-muted-strong">
                            <Check className="mt-1 size-3.5 shrink-0 text-brand" strokeWidth={2.5} aria-hidden="true" />
                            <InlineCode text={bullet} />
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {section.note ? <Note note={section.note} /> : null}
                  </section>
                ))}
              </div>

              <section className="border-t border-border pt-14 sm:pt-16">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">
                  Weiterführend
                </p>
                <h2 className="mt-3 text-[30px] font-semibold tracking-[-0.045em] text-foreground">
                  Vom Artikel in die Praxis
                </h2>
                <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  {article.relatedLinks.map((link) => {
                    const content = (
                      <>
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-sm font-semibold text-foreground">{link.label}</h3>
                          {link.external ? (
                            <ExternalLink className="size-3.5 shrink-0 text-muted transition group-hover:text-brand" aria-hidden="true" />
                          ) : (
                            <ArrowRight className="size-3.5 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden="true" />
                          )}
                        </div>
                        <p className="mt-2 text-xs leading-5 text-muted">{link.description}</p>
                      </>
                    );

                    const classes = "group rounded-2xl border border-border bg-surface p-5 transition hover:border-border-strong hover:shadow-md";

                    return link.external ? (
                      <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className={classes}>
                        {content}
                      </a>
                    ) : (
                      <Link key={link.href} href={link.href} className={classes}>
                        {content}
                      </Link>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        </article>

        <section className="border-t border-border bg-surface-subtle">
          <div className="mx-auto max-w-[1020px] px-5 py-16 sm:px-8 sm:py-20">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">
              Als Nächstes
            </p>
            <Link href={`/blog/${nextArticle.slug}`} className="group mt-4 flex flex-col justify-between gap-6 rounded-[24px] border border-border bg-surface p-7 shadow-sm transition hover:border-border-strong hover:shadow-lg sm:flex-row sm:items-end sm:p-9">
              <div>
                <span className={`rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${nextArticle.accentSoft}`}>
                  {nextArticle.category}
                </span>
                <h2 className="mt-5 max-w-2xl text-[28px] font-semibold leading-[1.05] tracking-[-0.045em] text-foreground sm:text-[34px]">
                  {nextArticle.title}
                </h2>
              </div>
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-strong text-on-strong transition group-hover:translate-x-1">
                <ArrowRight className="size-4" aria-hidden="true" />
              </span>
            </Link>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
