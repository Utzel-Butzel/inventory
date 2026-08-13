import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Barcode,
  Boxes,
  Braces,
  Camera,
  Check,
  CircleDot,
  Container,
  Github,
  History,
  ImageIcon,
  Layers3,
  MapPinned,
  PackageCheck,
  ScanLine,
  Smartphone,
  UploadCloud,
  WandSparkles,
} from "lucide-react";

import { CopyInstallCommand } from "@/components/marketing/copy-install-command";
import {
  MarketingFooter,
  MarketingHeader,
} from "@/components/marketing/site-chrome";

const githubUrl = "https://github.com/Utzel-Butzel/inventory";
const composeCommand =
  "docker compose -f docker-compose.yml -f docker-compose.local.yml up --build";

export const metadata: Metadata = {
  title: { absolute: "Open Inventory — Take a photo. AI builds the record." },
  description:
    "AI-native inventory that turns a photo into a structured record and a clean product cover. MIT licensed, self-hosted, with a native iOS app in the repository.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Open Inventory — Take a photo. AI builds the record.",
    description:
      "Recognize the item, generate the product cover, and manage the inventory from one photo.",
    images: ["/marketing/og-open-inventory-ai.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Open Inventory — Take a photo. AI builds the record.",
    description:
      "Recognize the item, generate the product cover, and manage the inventory from one photo.",
    images: ["/marketing/og-open-inventory-ai.png"],
  },
};

type Feature = {
  icon: LucideIcon;
  label: string;
  title: string;
  copy: string;
  tone: string;
};

const aiFeatures: Feature[] = [
  {
    icon: ScanLine,
    label: "Recognize",
    title: "Photo to record",
    copy: "AI suggests the title, description, type, tags, and alt text. You review the draft.",
    tone: "bg-brand-soft text-brand",
  },
  {
    icon: WandSparkles,
    label: "Generate",
    title: "Studio-style covers",
    copy: "Create a clean, square product cover with OpenAI or Google while keeping the original photo.",
    tone: "bg-success-soft text-success",
  },
  {
    icon: Camera,
    label: "Count",
    title: "Parts from one photo",
    copy: "AI proposes the quantity and confidence before you receive or issue the reviewed stock.",
    tone: "bg-warning-soft text-warning",
  },
];

const inventoryFeatures = [
  { icon: Barcode, label: "QR & barcode scanning" },
  { icon: Layers3, label: "Bulk & serialized stock" },
  { icon: MapPinned, label: "Locations & maps" },
  { icon: History, label: "Complete movement history" },
  { icon: PackageCheck, label: "Orders & assemblies" },
  { icon: Braces, label: "OpenAPI automation" },
];

function AutomationPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[650px]" aria-hidden="true">
      <div className="absolute -left-12 top-20 size-40 rounded-full bg-[#8ff0cc]/40 blur-[70px]" />
      <div className="absolute -right-10 bottom-12 size-52 rounded-full bg-[#665cff]/25 blur-[90px]" />

      <div className="relative overflow-hidden rounded-[28px] border border-white/70 bg-[#17181d] p-2.5 shadow-[0_38px_100px_rgba(24,20,38,0.3)] ring-1 ring-black/10">
        <div className="flex h-9 items-center gap-1.5 px-3">
          <span className="size-2 rounded-full bg-white/20" />
          <span className="size-2 rounded-full bg-white/20" />
          <span className="size-2 rounded-full bg-white/20" />
          <span className="ml-auto font-mono text-[8px] uppercase tracking-[0.12em] text-white/45">
            New capture
          </span>
        </div>

        <div className="overflow-hidden rounded-[20px] bg-background p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[8px] font-semibold uppercase tracking-[0.14em] text-brand">
                AI capture
              </p>
              <p className="mt-1 text-lg font-semibold tracking-[-0.04em] text-foreground">
                From photo to inventory
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1.5 text-[8px] font-semibold text-success">
              <CircleDot className="size-2.5" />
              Ready to review
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-[0.82fr_1.18fr]">
            <div className="relative min-h-[280px] overflow-hidden rounded-2xl bg-[#202126] sm:min-h-[330px]">
              <Image
                src="/og.png"
                fill
                sizes="(max-width: 640px) 90vw, 260px"
                alt=""
                className="object-cover object-[78%_center]"
              />
              <span className="absolute left-3 top-3 rounded-lg bg-black/45 px-2 py-1 font-mono text-[7px] uppercase tracking-[0.12em] text-white/70 backdrop-blur">
                Example capture
              </span>
              <span className="absolute bottom-3 left-3 right-3 flex items-center gap-2 rounded-xl border border-white/10 bg-black/55 p-2.5 text-white backdrop-blur-md">
                <Camera className="size-3.5 text-[#8ff0cc]" />
                <span className="text-[8px] font-medium">IMG_0842.JPG</span>
                <Check className="ml-auto size-3 text-[#8ff0cc]" />
              </span>
            </div>

            <div className="rounded-2xl border border-border bg-surface p-3.5">
              <div className="space-y-2">
                {[
                  ["Item recognized", "Cordless impact driver"],
                  ["Details suggested", "Title, type, and tags"],
                  ["Product cover", "Studio-style draft"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center gap-2.5 rounded-xl bg-surface-subtle p-2.5">
                    <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-success-soft text-success">
                      <Check className="size-3" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[8px] font-semibold text-foreground">{label}</p>
                      <p className="mt-0.5 truncate text-[7px] text-muted">{value}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3 rounded-xl border border-border p-3">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[linear-gradient(145deg,#26282f,#41444e)] text-[#9a92ff]">
                    <ImageIcon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[9px] font-semibold text-foreground">Cordless impact driver</p>
                    <p className="mt-1 text-[7px] text-muted">Tool · Workshop · TOOL-0042</p>
                  </div>
                </div>
                <div className="mt-3 flex gap-1.5">
                  {["18V", "power tool", "workshop"].map((tag) => (
                    <span key={tag} className="rounded-full bg-brand-soft px-2 py-1 text-[6px] font-medium text-brand">{tag}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <MarketingHeader />

      <main>
        <section className="relative overflow-hidden border-b border-border">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:56px_56px] opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent_84%)]" />
          <div className="pointer-events-none absolute left-[4%] top-28 size-[340px] rounded-full bg-[#8ff0cc]/30 blur-[110px]" />
          <div className="pointer-events-none absolute right-[4%] top-20 size-[430px] rounded-full bg-[#8175ff]/20 blur-[130px]" />

          <div className="relative mx-auto max-w-[1240px] px-5 pb-24 pt-16 sm:px-8 sm:pb-32 sm:pt-24 lg:pt-28">
            <div className="grid items-center gap-16 lg:grid-cols-[0.86fr_1.14fr] lg:gap-10">
              <div className="relative z-10 max-w-[650px] animate-fade-up">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                  AI-native inventory · MIT open source
                </p>

                <h1 className="mt-5 text-[clamp(3.35rem,6.7vw,6.25rem)] font-semibold leading-[0.91] tracking-[-0.07em] text-foreground">
                  Take a photo.
                  <span className="block text-brand">AI builds the record.</span>
                </h1>
                <p className="mt-7 max-w-[570px] text-[17px] leading-7 text-muted sm:text-[19px] sm:leading-8">
                  Open Inventory recognizes the item, writes the details, and
                  creates a clean product cover. You review the result.
                </p>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/docs#docker"
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-brand-solid px-5 text-sm font-semibold text-on-brand shadow-[0_12px_30px_rgba(102,92,255,0.25)] transition hover:-translate-y-0.5 hover:bg-brand-hover"
                  >
                    <Container className="size-[17px]" />
                    Install with Docker
                  </Link>
                  <a
                    href={githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] border border-border bg-surface/80 px-5 text-sm font-semibold text-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface"
                  >
                    <Github className="size-[17px]" />
                    View on GitHub
                  </a>
                </div>

                <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[11px] font-semibold text-muted">
                  {["MIT licensed", "Self-hosted", "Native iOS app"].map((item) => (
                    <span key={item} className="flex items-center gap-1.5">
                      <Check className="size-3 text-success" strokeWidth={2.5} />
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <div className="animate-fade-up animation-delay-2 lg:pl-3">
                <AutomationPreview />
              </div>
            </div>
          </div>
        </section>

        <section id="ai" className="scroll-mt-24 bg-background py-24 sm:py-32">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                Three AI jobs
              </p>
              <h2 className="mt-4 text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] text-foreground sm:text-[60px]">
                Recognize. Generate. Count.
              </h2>
            </div>

            <div className="mt-14 grid gap-4 lg:grid-cols-3">
              {aiFeatures.map((feature) => {
                const Icon = feature.icon;
                return (
                  <article key={feature.title} className="rounded-[26px] border border-border bg-surface p-6 transition duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-md)] sm:p-8">
                    <div className="flex items-center justify-between">
                      <span className={`grid size-11 place-items-center rounded-2xl ${feature.tone}`}>
                        <Icon className="size-5" strokeWidth={1.9} />
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted">{feature.label}</span>
                    </div>
                    <h3 className="mt-16 text-[26px] font-semibold tracking-[-0.045em] text-foreground">{feature.title}</h3>
                    <p className="mt-3 text-[15px] leading-6 text-muted">{feature.copy}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="inventory" className="scroll-mt-20 overflow-hidden bg-[#121318] py-24 text-white sm:py-32">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="grid gap-9 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ff0cc]">
                  Modern inventory
                </p>
                <h2 className="mt-4 text-[44px] font-semibold leading-[0.96] tracking-[-0.06em] sm:text-[62px]">
                  Scan it. Move it. Find it.
                </h2>
              </div>
              <p className="max-w-lg text-[17px] leading-7 text-white/60 lg:justify-self-end">
                Bulk stock, individual units, locations, orders, assemblies,
                and every movement in one system.
              </p>
            </div>

            <div className="mt-12 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {inventoryFeatures.map((feature) => {
                const Icon = feature.icon;
                return (
                  <div key={feature.label} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-4 text-sm font-medium text-white/75">
                    <Icon className="size-4 text-[#8ff0cc]" strokeWidth={1.9} />
                    {feature.label}
                  </div>
                );
              })}
            </div>

            <div className="relative mt-12 overflow-hidden rounded-[28px] border border-white/10 bg-[#1b1c22] p-2 shadow-2xl sm:p-3">
              <div className="relative overflow-hidden rounded-[20px] bg-[#f4f5f7]">
                <Image
                  src="/marketing/stock-management.png"
                  width={1440}
                  height={1000}
                  alt="Open Inventory stock management with available stock, incoming stock, minimum level, average usage, runway, and assembly status"
                  className="h-auto w-full"
                />
              </div>
            </div>
          </div>
        </section>

        <section id="app" className="scroll-mt-20 border-b border-border bg-surface-muted py-24 sm:py-32">
          <div className="mx-auto grid max-w-[1120px] gap-14 px-5 sm:px-8 lg:grid-cols-[0.75fr_1.25fr] lg:items-center">
            <div className="relative mx-auto w-full max-w-[360px] pb-8" aria-hidden="true">
              <div className="overflow-hidden rounded-[38px] border border-border bg-surface-subtle p-3 shadow-[var(--shadow-md)]">
                <Image
                  src="/marketing/ios-app-icon.png"
                  width={1024}
                  height={1024}
                  alt=""
                  className="h-auto w-full rounded-[29px]"
                />
              </div>
              <div className="absolute -bottom-1 -right-4 w-[210px] rounded-2xl border border-border bg-surface p-3.5 shadow-[var(--shadow-md)]">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-9 place-items-center rounded-xl bg-brand-soft text-brand">
                    <UploadCloud className="size-4" />
                  </span>
                  <div>
                    <p className="text-[9px] font-semibold text-foreground">Capture queue ready</p>
                    <p className="mt-0.5 text-[8px] text-muted">Upload · analyze · cover</p>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-strong">
                <Smartphone className="size-3.5 text-brand" />
                Native iOS app
              </span>
              <h2 className="mt-5 max-w-2xl text-[44px] font-semibold leading-[0.97] tracking-[-0.06em] sm:text-[62px]">
                Inventory from the camera in your pocket.
              </h2>
              <p className="mt-6 max-w-xl text-[16px] leading-7 text-muted">
                Capture photos, scan QR and common barcodes, find or create an
                item, and let the upload queue run analysis and optional cover
                generation.
              </p>

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {[
                  { icon: Camera, text: "Photo → analysis → product cover" },
                  { icon: Barcode, text: "QR and common barcode formats" },
                  { icon: UploadCloud, text: "Crash-safe upload and retry queue" },
                  { icon: PackageCheck, text: "Receive and issue stock on iPhone" },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.text} className="flex items-center gap-3 rounded-2xl bg-surface/70 p-4 text-sm font-medium text-muted-strong">
                      <Icon className="size-4 shrink-0 text-brand" />
                      {item.text}
                    </div>
                  );
                })}
              </div>

              <a
                href={`${githubUrl}/tree/main/ios/Inventory`}
                target="_blank"
                rel="noreferrer"
                className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-brand hover:text-brand-strong"
              >
                Explore the iOS app
                <ArrowRight className="size-4" />
              </a>
              <p className="mt-3 text-xs text-muted">Included in the repository · iOS 17 or newer</p>
            </div>
          </div>
        </section>

        <section id="docker" className="scroll-mt-20 bg-background py-24 sm:py-32">
          <div className="mx-auto grid max-w-[1240px] gap-14 px-5 sm:px-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                MIT licensed · self-hosted
              </p>
              <h2 className="mt-4 text-[44px] font-semibold leading-[0.97] tracking-[-0.06em] sm:text-[60px]">
                Open source. Yours to run.
              </h2>
              <p className="mt-6 max-w-lg text-[16px] leading-7 text-muted">
                Web app, PostgreSQL migrations, OpenAPI, Docker setup, and the
                native iOS app — all in one MIT-licensed repository.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/docs#docker" className="inline-flex h-11 items-center gap-2 rounded-xl bg-strong px-4 text-sm font-semibold text-on-strong transition hover:opacity-90">
                  Read the setup docs
                  <ArrowRight className="size-4" />
                </Link>
                <a href={githubUrl} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground transition hover:border-border-strong">
                  <Github className="size-4" />
                  View the source
                </a>
              </div>
            </div>

            <div className="overflow-hidden rounded-[26px] border border-white/10 bg-[#17181d] shadow-[0_28px_80px_rgba(28,25,40,0.2)]">
              <div className="flex h-14 items-center border-b border-white/10 px-5">
                <div className="flex gap-1.5">
                  <span className="size-2.5 rounded-full bg-[#ff6a64]" />
                  <span className="size-2.5 rounded-full bg-[#f7c84d]" />
                  <span className="size-2.5 rounded-full bg-[#67d68c]" />
                </div>
                <p className="ml-4 font-mono text-[10px] text-white/55">open-inventory — setup</p>
                <div className="ml-auto"><CopyInstallCommand command={composeCommand} /></div>
              </div>
              <div className="overflow-x-auto p-5 font-mono text-[11px] leading-7 sm:p-7 sm:text-[13px]">
                <p><span className="text-[#8ff0cc]">$</span> <span className="text-white/85">git clone</span> <span className="text-[#9a91ff]">{githubUrl}.git</span></p>
                <p><span className="text-[#8ff0cc]">$</span> <span className="text-white/85">cd inventory</span></p>
                <p><span className="text-[#8ff0cc]">$</span> <span className="text-white/85">cp .env.example .env</span></p>
                <p className="my-2 text-white/55"># Add the required secrets and admin password hash</p>
                <p className="whitespace-nowrap"><span className="text-[#8ff0cc]">$</span> <span className="text-white/85">docker compose -f docker-compose.yml</span> <span className="text-[#9a91ff]">\</span></p>
                <p className="whitespace-nowrap pl-4 text-white/85">-f docker-compose.local.yml up --build</p>
                <div className="mt-6 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] p-4 text-[10px] font-semibold text-[#8ff0cc]">
                  <CircleDot className="size-3.5" />
                  Ready on http://localhost:3000
                </div>
              </div>
              <div className="grid grid-cols-4 border-t border-white/10 text-center font-mono text-[8px] uppercase tracking-[0.12em] text-white/55 sm:text-[9px]">
                <span className="border-r border-white/10 px-2 py-3">Next.js</span>
                <span className="border-r border-white/10 px-2 py-3">Postgres</span>
                <span className="border-r border-white/10 px-2 py-3">Docker</span>
                <span className="px-2 py-3">MIT</span>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-brand-solid px-5 py-8 sm:px-8 sm:py-12">
          <div className="relative mx-auto max-w-[1180px] overflow-hidden rounded-[30px] bg-[#17181d] px-6 py-16 text-center text-white sm:px-12 sm:py-20">
            <div className="pointer-events-none absolute left-1/2 top-0 h-60 w-[620px] -translate-x-1/2 bg-[radial-gradient(ellipse_at_top,rgba(143,240,204,0.24),transparent_68%)]" />
            <div className="relative">
              <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#8ff0cc] text-[#17382d] shadow-[0_0_0_8px_rgba(143,240,204,0.08)]">
                <Boxes className="size-6" />
              </span>
              <h2 className="mx-auto mt-7 max-w-3xl text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] sm:text-[62px]">
                The modern way to inventory starts with a photo.
              </h2>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <Link href="/docs#docker" className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-[#8ff0cc] px-5 text-sm font-semibold text-[#17382d] transition hover:-translate-y-0.5 hover:bg-[#a1f5d6]">
                  <Container className="size-4" />
                  Start with Docker
                </Link>
                <Link href="/login" className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] border border-white/15 bg-white/[0.06] px-5 text-sm font-semibold text-white transition hover:bg-white/10">
                  Open the web app
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
