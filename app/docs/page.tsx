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
const composeCommand =
  "docker compose -f docker-compose.yml -f docker-compose.local.yml up --build";

export const metadata: Metadata = {
  title: { absolute: "Documentation — Open Inventory" },
  description:
    "Install, configure, integrate, and operate Open Inventory on your own infrastructure.",
  alternates: { canonical: "/docs" },
};

const navigation = [
  { label: "Overview", href: "#overview" },
  { label: "Docker install", href: "#docker" },
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
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#665cff]">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-[32px] font-semibold tracking-[-0.05em] text-[#202125] sm:text-[40px]">
        {title}
      </h2>
      <div className="mt-4 text-[15px] leading-7 text-[#696b71]">{children}</div>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-dvh bg-[#f7f5ef] text-[#1a1b1e]">
      <MarketingHeader />

      <main>
        <section
          id="overview"
          className="scroll-mt-24 border-b border-black/[0.07] bg-[#121318] text-white"
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
              <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#a09f9a]">
                On this page
              </p>
              <nav className="mt-3 grid gap-1" aria-label="Documentation sections">
                {navigation.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-xl px-3 py-2.5 text-[13px] font-medium text-[#73757a] transition hover:bg-white hover:text-[#292a2e]"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-7 border-t border-black/[0.08] pt-6">
                <a
                  href={`${githubUrl}#readme`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 px-3 text-xs font-semibold text-[#6257dd] hover:text-[#4539c5]"
                >
                  Full repository README
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              </div>
            </div>
          </aside>

          <article className="min-w-0">
            <section className="border-b border-black/[0.08] pb-16">
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
                    <div key={item.title} className="rounded-2xl border border-black/[0.07] bg-white p-5">
                      <Icon className="size-5 text-[#665cff]" aria-hidden="true" />
                      <h3 className="mt-5 text-sm font-semibold text-[#323438]">{item.title}</h3>
                      <p className="mt-1.5 text-xs leading-5 text-[#818389]">{item.text}</p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section id="docker" className="scroll-mt-24 border-b border-black/[0.08] py-16">
              <SectionHeading eyebrow="01 · Installation" title="Deploy with Docker Compose">
                <p>
                  You need Git, Docker with Compose v2, and Node.js 22.13 or
                  newer for the included password-hash helper. The application
                  itself runs inside Docker.
                </p>
              </SectionHeading>

              <ol className="mt-10 space-y-10">
                <li>
                  <div className="flex items-start gap-4">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#e8e4ff] font-mono text-[10px] font-bold text-[#5b50df]">1</span>
                    <div>
                      <h3 className="text-base font-semibold text-[#303136]">Clone and create the environment file</h3>
                      <p className="mt-2 text-sm leading-6 text-[#74767c]">Keep the checked-in example as your reference and put deployment values in <code className="rounded bg-black/[0.05] px-1.5 py-0.5 font-mono text-[12px]">.env</code>.</p>
                    </div>
                  </div>
                  <CodeBlock label="clone" copy={`git clone ${githubUrl}.git\ncd inventory\ncp .env.example .env`}>
                    {`git clone ${githubUrl}.git\ncd inventory\ncp .env.example .env`}
                  </CodeBlock>
                </li>

                <li>
                  <div className="flex items-start gap-4">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#e8e4ff] font-mono text-[10px] font-bold text-[#5b50df]">2</span>
                    <div>
                      <h3 className="text-base font-semibold text-[#303136]">Generate secrets and the login hash</h3>
                      <p className="mt-2 text-sm leading-6 text-[#74767c]">Use a URL-safe hex value for the database password. Keep bcrypt hashes in single quotes in the Compose environment file so their dollar signs stay literal.</p>
                    </div>
                  </div>
                  <CodeBlock label="secrets" copy={'openssl rand -hex 32\nopenssl rand -base64 48\nnpm install\nnpm run auth:hash -- "choose a strong password"'}>
                    {'openssl rand -hex 32        # POSTGRES_PASSWORD\nopenssl rand -base64 48     # AUTH_SECRET\nnpm install\nnpm run auth:hash -- "choose a strong password"'}
                  </CodeBlock>
                </li>

                <li>
                  <div className="flex items-start gap-4">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#e8e4ff] font-mono text-[10px] font-bold text-[#5b50df]">3</span>
                    <div>
                      <h3 className="text-base font-semibold text-[#303136]">Set the required values</h3>
                      <p className="mt-2 text-sm leading-6 text-[#74767c]">For a local installation, the public URL can be localhost. Remote installations must use the exact public HTTPS origin.</p>
                    </div>
                  </div>
                  <CodeBlock label=".env">
                    {`POSTGRES_PASSWORD=<hex value from step 2>\nAUTH_SECRET=<random value from step 2>\nAUTH_URL=http://localhost:3000\nAUTH_TRUST_HOST=true\n\nSIMPLE_AUTH_EMAIL=admin@example.com\nSIMPLE_AUTH_NAME=Inventory admin\nSIMPLE_AUTH_PASSWORD_HASH='<bcrypt hash from step 2>'`}
                  </CodeBlock>
                </li>

                <li>
                  <div className="flex items-start gap-4">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#dff8ed] font-mono text-[10px] font-bold text-[#177e5c]">4</span>
                    <div>
                      <h3 className="text-base font-semibold text-[#303136]">Start the stack</h3>
                      <p className="mt-2 text-sm leading-6 text-[#74767c]">The local override binds the app to <code className="rounded bg-black/[0.05] px-1.5 py-0.5 font-mono text-[12px]">127.0.0.1:3000</code>. Named volumes survive container replacement.</p>
                    </div>
                  </div>
                  <CodeBlock label="docker compose" copy={composeCommand}>
                    {`docker compose -f docker-compose.yml \\\n  -f docker-compose.local.yml up --build`}
                  </CodeBlock>
                  <div className="rounded-2xl border border-[#bce8d5] bg-[#effbf6] p-4 text-sm leading-6 text-[#266b53]">
                    Open <a href="http://localhost:3000" className="font-semibold underline underline-offset-4">http://localhost:3000</a> and sign in with the email and password you configured.
                  </div>
                </li>
              </ol>
            </section>

            <section id="configuration" className="scroll-mt-24 border-b border-black/[0.08] py-16">
              <SectionHeading eyebrow="02 · Configuration" title="Keep the core local. Add only what you need.">
                <p>
                  Database and local files can stay on your infrastructure.
                  Maps, hosted storage, Auth0, and AI providers are explicit
                  integrations you can configure or leave disabled.
                </p>
              </SectionHeading>

              <div className="mt-9 divide-y divide-black/[0.07] rounded-2xl border border-black/[0.07] bg-white">
                {[
                  { icon: KeyRound, title: "Accounts and roles", copy: "Bootstrap the first administrator, then manage admin, editor, and viewer accounts from Settings. Auth0 is optional." },
                  { icon: HardDrive, title: "File storage", copy: "Use the persistent local upload volume by default, or point Open Inventory at an Openinary service." },
                  { icon: Sparkles, title: "AI assistance", copy: "OpenAI-compatible analysis and OpenAI or Google image editing are optional. Nothing is sent to an AI provider until you configure and use it." },
                  { icon: Database, title: "Maps and location", copy: "Street and satellite defaults require external tile services. Compatible tile URLs can be replaced with your own infrastructure." },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="flex gap-4 p-5 sm:p-6">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#efecff] text-[#6256e4]">
                        <Icon className="size-[18px]" aria-hidden="true" />
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold text-[#33353a]">{item.title}</h3>
                        <p className="mt-1.5 text-sm leading-6 text-[#777980]">{item.copy}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <a href={`${githubUrl}#authentication`} target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#5a4fda] hover:text-[#4034c4]">
                Read every environment option in the README
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            </section>

            <section id="api" className="scroll-mt-24 border-b border-black/[0.08] py-16">
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
                    <div key={item.title} className="rounded-2xl border border-black/[0.07] bg-white p-5">
                      <Icon className="size-5 text-[#665cff]" aria-hidden="true" />
                      <h3 className="mt-5 text-sm font-semibold text-[#33353a]">{item.title}</h3>
                      <p className="mt-1.5 text-xs leading-5 text-[#82848a]">{item.text}</p>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <a href="/openapi.yaml" className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#17181d] px-4 text-sm font-semibold text-white hover:bg-[#2d2e33]">
                  <FileCode2 className="size-4" aria-hidden="true" />
                  Open YAML
                </a>
                <a href="/openapi.json" className="inline-flex h-11 items-center gap-2 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-[#34363a] hover:border-black/20">
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

              <div className="mt-8 rounded-2xl border border-black/[0.07] bg-white p-6 sm:p-8">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-[#ddf8ec] text-[#157d5a]">
                    <HeartPulse className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-[#313338]">Deployment checklist</h3>
                    <p className="mt-1 text-xs text-[#898b91]">The boring things that keep the useful things safe.</p>
                  </div>
                </div>
                <ul className="mt-7 grid gap-4 text-sm text-[#55575d] sm:grid-cols-2">
                  {[
                    "Health check returns 200 at /api/health",
                    "Database and upload volumes are persistent",
                    "PostgreSQL and uploads are backed up together",
                    "Login, upload, and token flows are smoke-tested",
                    "Remote AUTH_URL is the exact HTTPS origin",
                    "AI and storage credentials are set only when used",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-[#16815c]" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-8 flex flex-col gap-4 rounded-2xl bg-[#e9e5ff] p-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <BookOpenText className="mt-0.5 size-5 shrink-0 text-[#5a4fda]" aria-hidden="true" />
                  <div>
                    <h3 className="text-sm font-semibold text-[#353044]">Need the complete reference?</h3>
                    <p className="mt-1 text-xs leading-5 text-[#716b83]">The repository README covers Dokploy, authentication, stock behavior, native iOS, and every environment variable.</p>
                  </div>
                </div>
                <a href={`${githubUrl}#readme`} target="_blank" rel="noreferrer" className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#665cff] px-4 text-xs font-semibold text-white hover:bg-[#5549e8]">
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
