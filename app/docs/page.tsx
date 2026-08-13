import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Braces,
  Check,
  Container,
  Database,
  ExternalLink,
  FileCode2,
  HardDrive,
  HeartPulse,
  KeyRound,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { CopyInstallCommand } from "@/components/marketing/copy-install-command";
import {
  MarketingFooter,
  MarketingHeader,
} from "@/components/marketing/site-chrome";

const githubUrl = "https://github.com/Utzel-Butzel/inventory";
const quickStartCommand = `git clone ${githubUrl}.git
cd inventory
./scripts/install.sh`;
const dokployDeployUrl = `${githubUrl}/tree/main/deploy/dokploy`;
const coolifyDeployUrl = `${githubUrl}/tree/main/deploy/coolify`;

export const metadata: Metadata = {
  title: { absolute: "Documentation — Open Inventory" },
  description:
    "Install, configure, integrate, and operate Open Inventory on your own infrastructure.",
  alternates: { canonical: "/docs" },
};

const navigation = [
  { label: "Overview", href: "#overview" },
  { label: "Install & deploy", href: "#docker" },
  { label: "Configuration", href: "#configuration" },
  { label: "API", href: "#api" },
  { label: "Operations", href: "#operations" },
];

function CodeBlock({
  children,
  copy,
  label,
}: {
  children: React.ReactNode;
  copy?: string;
  label?: string;
}) {
  return (
    <div className="my-6 overflow-hidden rounded-2xl border border-white/10 bg-[#17181d] shadow-lg">
      <div className="flex h-11 items-center border-b border-white/10 px-4">
        <div className="flex gap-1.5">
          <span className="size-2 rounded-full bg-[#ff6a64]" />
          <span className="size-2 rounded-full bg-[#f7c84d]" />
          <span className="size-2 rounded-full bg-[#67d68c]" />
        </div>
        <span className="ml-3 font-mono text-[9px] text-white/55">
          {label ?? "terminal"}
        </span>
        {copy ? (
          <div className="ml-auto">
            <CopyInstallCommand command={copy} />
          </div>
        ) : null}
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[12px] leading-7 text-white/75 sm:p-6">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-[32px] font-semibold tracking-[-0.05em] text-foreground sm:text-[40px]">
        {title}
      </h2>
      <div className="mt-4 text-[15px] leading-7 text-muted">{children}</div>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <MarketingHeader />

      <main>
        <section
          id="overview"
          className="scroll-mt-24 border-b border-border bg-[#121318] text-white"
        >
          <div className="relative mx-auto max-w-[1240px] overflow-hidden px-5 py-20 sm:px-8 sm:py-28">
            <div className="pointer-events-none absolute right-0 top-0 size-[480px] rounded-full bg-[#665cff]/25 blur-[130px]" />
            <div className="pointer-events-none absolute -left-32 bottom-0 size-[360px] rounded-full bg-[#8ff0cc]/10 blur-[100px]" />
            <div className="relative max-w-3xl">
              <Link
                href="/"
                className="inline-flex items-center gap-2 text-xs font-semibold text-white/65 transition hover:text-white"
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                Back to Open Inventory
              </Link>
              <p className="mt-10 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ff0cc]">
                Documentation
              </p>
              <h1 className="mt-5 text-[clamp(3.2rem,7vw,6.2rem)] font-semibold leading-[0.92] tracking-[-0.07em]">
                From clone to
                <span className="block text-[#9188ff]">first record.</span>
              </h1>
              <p className="mt-7 max-w-2xl text-[17px] leading-8 text-white/50">
                A practical path through local Docker deployment, secure
                configuration, the REST API, and the operational details that
                keep your inventory durable.
              </p>
            </div>
          </div>
        </section>

        <div className="mx-auto grid max-w-[1240px] gap-10 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[220px_minmax(0,760px)] lg:justify-between">
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                On this page
              </p>
              <nav className="mt-3 grid gap-1" aria-label="Documentation sections">
                {navigation.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-xl px-3 py-2.5 text-[13px] font-medium text-muted transition hover:bg-surface hover:text-foreground"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-7 border-t border-border pt-6">
                <a
                  href={`${githubUrl}#readme`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 px-3 text-xs font-semibold text-brand hover:text-brand-strong"
                >
                  Full repository README
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              </div>
            </div>
          </aside>

          <article className="min-w-0">
            <section className="border-b border-border pb-16">
              <SectionHeading eyebrow="Start here" title="What you are deploying">
                <p>
                  Open Inventory is a Next.js application backed by PostgreSQL.
                  The checked-in Compose stack starts the database, runs every
                  bundled migration, then starts the application with persistent
                  volumes for database data and local uploads.
                </p>
              </SectionHeading>

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {[
                  { icon: Container, title: "Application", text: "A standalone Next.js production image." },
                  { icon: Database, title: "Database", text: "PostgreSQL 16 with migration gating." },
                  { icon: HardDrive, title: "Storage", text: "Persistent local uploads or Openinary." },
                  { icon: ShieldCheck, title: "Authentication", text: "Local roles with optional Auth0." },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="rounded-2xl border border-border bg-surface p-5">
                      <Icon className="size-5 text-brand" aria-hidden="true" />
                      <h3 className="mt-5 text-sm font-semibold text-foreground">{item.title}</h3>
                      <p className="mt-1.5 text-xs leading-5 text-muted">{item.text}</p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section id="docker" className="scroll-mt-24 border-b border-border py-16">
              <SectionHeading eyebrow="01 · Installation" title="Choose the easiest path for your server">
                <p>
                  Run the guided Docker installer on any host with Git, Docker
                  Compose v2, OpenSSL, and curl, or import the catalog-ready
                  definitions for Dokploy and Coolify. All three paths use the same
                  production image, migrations, health check, and persistent
                  storage model.
                </p>
              </SectionHeading>

              <div className="mt-9 grid gap-3 sm:grid-cols-3">
                {[
                  {
                    icon: Container,
                    title: "Docker Compose",
                    text: "Clone the repository and let the installer create secure settings and start the complete stack.",
                    href: "#docker-quick-start",
                    label: "Quick start",
                  },
                  {
                    icon: Sparkles,
                    title: "Dokploy template",
                    text: "Import the platform-native definition now; it is ready for one-click catalog inclusion.",
                    href: dokployDeployUrl,
                    label: "Open Dokploy files",
                  },
                  {
                    icon: Sparkles,
                    title: "Coolify template",
                    text: "Import the matching service definition now; it is ready for one-click catalog inclusion.",
                    href: coolifyDeployUrl,
                    label: "Open Coolify files",
                  },
                ].map((option) => {
                  const Icon = option.icon;
                  const external = option.href.startsWith("http");
                  return (
                    <article key={option.title} className="flex flex-col rounded-2xl border border-border bg-surface p-5">
                      <Icon className="size-5 text-brand" aria-hidden="true" />
                      <h3 className="mt-5 text-sm font-semibold text-foreground">{option.title}</h3>
                      <p className="mt-2 text-xs leading-5 text-muted">{option.text}</p>
                      <a
                        href={option.href}
                        target={external ? "_blank" : undefined}
                        rel={external ? "noreferrer" : undefined}
                        className="mt-auto inline-flex items-center gap-1.5 pt-5 text-xs font-semibold text-brand hover:text-brand-strong"
                      >
                        {option.label}
                        {external ? <ExternalLink className="size-3" aria-hidden="true" /> : <ArrowRight className="size-3" aria-hidden="true" />}
                      </a>
                    </article>
                  );
                })}
              </div>

              <div id="docker-quick-start" className="scroll-mt-24 pt-14">
                <h3 className="text-xl font-semibold tracking-[-0.03em] text-foreground">
                  Docker quick start
                </h3>
                <p className="mt-3 text-sm leading-6 text-muted">
                  The installer creates a private <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[12px]">.env</code>,
                  generates the required secrets and a bootstrap administrator,
                  starts PostgreSQL and Open Inventory, and waits for the health
                  check. You do not need Node.js or a manually prepared password
                  hash for this path.
                </p>

                <CodeBlock label="three commands" copy={quickStartCommand}>
                  {quickStartCommand}
                </CodeBlock>

                <div className="rounded-2xl border border-success-border bg-success-soft p-5 text-sm leading-6 text-success">
                  <p className="font-semibold">First login</p>
                  <p className="mt-1">
                    When installation finishes, the terminal prints the admin
                    email (by default <code className="font-mono text-[12px]">admin@inventory.local</code>)
                    and an automatically generated bootstrap password. Sign in
                    at <a href="http://localhost:3000" className="font-semibold underline underline-offset-4">http://localhost:3000</a>,
                    then change the password under <strong>Settings → Users</strong>.
                    The production start converts the bootstrap value to bcrypt
                    before the server starts and removes its plaintext value
                    from the running process; the database stores only the hash
                    after the first successful login.
                  </p>
                </div>
              </div>

              <div className="mt-12 rounded-2xl border border-border bg-surface p-6">
                <h3 className="text-base font-semibold text-foreground">Dokploy and Coolify</h3>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Pick your platform, open its deploy directory, and import the
                  included template or Compose definition. It configures
                  PostgreSQL, persistent uploads, port 3000, and
                  <code className="ml-1 rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[12px]">/api/health</code>.
                  The platform generates the bootstrap password as a secret;
                  find it in Dokploy&apos;s or Coolify&apos;s environment UI for the
                  initial login. Change the password in <strong>Settings → Users</strong>;
                  the bootstrap credential cannot replace an existing account.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <a href={dokployDeployUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-solid px-4 text-xs font-semibold text-on-brand hover:bg-brand-hover">
                    Import for Dokploy
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                  <a href={coolifyDeployUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-solid px-4 text-xs font-semibold text-on-brand hover:bg-brand-hover">
                    Import for Coolify
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                </div>
              </div>
            </section>

            <section id="configuration" className="scroll-mt-24 border-b border-border py-16">
              <SectionHeading eyebrow="02 · Configuration" title="Keep the core local. Add only what you need.">
                <p>
                  Database and local files can stay on your infrastructure.
                  Maps, hosted storage, Auth0, and AI providers are explicit
                  integrations you can configure or leave disabled.
                </p>
              </SectionHeading>

              <div className="mt-9 divide-y divide-border rounded-2xl border border-border bg-surface">
                {[
                  { icon: KeyRound, title: "Accounts and roles", copy: "The guided deployment paths generate the first bootstrap login automatically. Change that password after signing in, then manage admin, editor, and viewer accounts from Settings. Auth0 is optional." },
                  { icon: HardDrive, title: "File storage", copy: "Use the persistent local upload volume by default, or point Open Inventory at an Openinary service." },
                  { icon: Sparkles, title: "AI assistance", copy: "OpenAI-compatible analysis and OpenAI or Google image editing are optional. Nothing is sent to an AI provider until you configure and use it." },
                  { icon: Database, title: "Maps and location", copy: "Street and satellite defaults require external tile services. Compatible tile URLs can be replaced with your own infrastructure." },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="flex gap-4 p-5 sm:p-6">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                        <Icon className="size-[18px]" aria-hidden="true" />
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                        <p className="mt-1.5 text-sm leading-6 text-muted">{item.copy}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <a href={`${githubUrl}#authentication`} target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand hover:text-brand-strong">
                Read every environment option in the README
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            </section>

            <section id="api" className="scroll-mt-24 border-b border-border py-16">
              <SectionHeading eyebrow="03 · Integration" title="A scoped API, described in the repository.">
                <p>
                  Administrators can issue expiring, revocable bearer tokens.
                  The public OpenAPI 3.1 files document resource, stock, scan,
                  purchase-order, authentication, and statistics endpoints.
                </p>
              </SectionHeading>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {[
                  { icon: Braces, title: "JSON REST API", text: "Stable versioned routes under /api/v1." },
                  { icon: ShieldCheck, title: "Scoped tokens", text: "Read, write, and AI permissions." },
                  { icon: FileCode2, title: "OpenAPI 3.1", text: "YAML and JSON descriptions included." },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="rounded-2xl border border-border bg-surface p-5">
                      <Icon className="size-5 text-brand" aria-hidden="true" />
                      <h3 className="mt-5 text-sm font-semibold text-foreground">{item.title}</h3>
                      <p className="mt-1.5 text-xs leading-5 text-muted">{item.text}</p>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/api-docs" className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-solid px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover">
                  <BookOpenText className="size-4" aria-hidden="true" />
                  Explore API reference
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
                <a href="/openapi.yaml" className="inline-flex h-11 items-center gap-2 rounded-xl bg-strong px-4 text-sm font-semibold text-on-strong hover:opacity-90">
                  <FileCode2 className="size-4" aria-hidden="true" />
                  Open YAML
                </a>
                <a href="/openapi.json" className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground hover:border-border-strong">
                  Open JSON
                  <ArrowRight className="size-4" aria-hidden="true" />
                </a>
              </div>
            </section>

            <section id="operations" className="scroll-mt-24 pt-16">
              <SectionHeading eyebrow="04 · Operations" title="Make durability part of the deployment.">
                <p>
                  Open Inventory keeps database records and stored media as one
                  logical dataset. Back them up together, test recovery, and use
                  the built-in health endpoint for deployment checks.
                </p>
              </SectionHeading>

              <div className="mt-8 rounded-2xl border border-border bg-surface p-6 sm:p-8">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-success-soft text-success">
                    <HeartPulse className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Deployment checklist</h3>
                    <p className="mt-1 text-xs text-muted">The boring things that keep the useful things safe.</p>
                  </div>
                </div>
                <ul className="mt-7 grid gap-4 text-sm text-muted-strong sm:grid-cols-2">
                  {[
                    "Health check returns 200 at /api/health",
                    "Database and upload volumes are persistent",
                    "PostgreSQL and uploads are backed up together",
                    "Login, upload, and token flows are smoke-tested",
                    "Remote AUTH_URL is the exact HTTPS origin",
                    "AI and storage credentials are set only when used",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-8 flex flex-col gap-4 rounded-2xl bg-brand-soft p-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <BookOpenText className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden="true" />
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Need the complete reference?</h3>
                    <p className="mt-1 text-xs leading-5 text-muted">The repository README covers Docker, Dokploy, Coolify, authentication, stock behavior, native iOS, and every environment variable.</p>
                  </div>
                </div>
                <a href={`${githubUrl}#readme`} target="_blank" rel="noreferrer" className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-solid px-4 text-xs font-semibold text-on-brand hover:bg-brand-hover">
                  Open README
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </div>
            </section>
          </article>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
