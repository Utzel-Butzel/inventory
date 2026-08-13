import type { Metadata } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpenText,
  Braces,
  Check,
  Code2,
  Container,
  Database,
  Eye,
  FileCode2,
  Github,
  GitPullRequest,
  Globe2,
  HardDrive,
  Heart,
  KeyRound,
  LockKeyhole,
  Server,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Workflow,
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
  title: { absolute: "Open Source & Self-hosting — Open Inventory" },
  description:
    "MIT-lizenziertes Inventarsystem mit Docker, PostgreSQL, nativer iOS-App und offener OpenAPI-3.1-Schnittstelle – auf deiner Infrastruktur betreibbar.",
  alternates: { canonical: "/open-source" },
  openGraph: {
    title: "Open Inventory ist Open Source",
    description:
      "Prüfbarer Code, MIT-Lizenz, Docker/PostgreSQL und dokumentierte API für deinen eigenen Inventar-Stack.",
    images: ["/og.png"],
  },
};

type Principle = {
  icon: LucideIcon;
  title: string;
  copy: string;
};

const principles: Principle[] = [
  {
    icon: Eye,
    title: "Prüfbar",
    copy: "Web-App, API, Datenbankmigrationen und iOS-App liegen offen in einem Repository. Du kannst nachvollziehen, was ausgeführt wird.",
  },
  {
    icon: Settings2,
    title: "Anpassbar",
    copy: "Erweitere Typen und Felder in der Oberfläche oder passe den MIT-lizenzierten Code an deinen Prozess und deine Infrastruktur an.",
  },
  {
    icon: Server,
    title: "Selbst betreibbar",
    copy: "Docker Compose, PostgreSQL, Healthcheck und Migrationen sind enthalten. Domain, Secrets, Backups und Updates bleiben Betriebsentscheidungen deiner Instanz.",
  },
  {
    icon: Braces,
    title: "Integrierbar",
    copy: "Eine eingecheckte OpenAPI-3.1-Spezifikation und scoped Bearer-Tokens verbinden Open Inventory mit eigenen Apps, Skripten und Automationen.",
  },
];

const evidence: Array<{
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  copy: string;
  links: Array<{ label: string; href: string }>;
}> = [
  {
    icon: FileCode2,
    eyebrow: "Lizenz",
    title: "MIT im Wortlaut",
    copy: "Der vollständige Lizenztext liegt im Repository. Er erlaubt Nutzung, Änderung und Weitergabe unter den dort genannten Bedingungen.",
    links: [
      { label: "LICENSE ansehen", href: `${githubUrl}/blob/main/LICENSE` },
    ],
  },
  {
    icon: Container,
    eyebrow: "Betrieb",
    title: "Docker-Konfiguration zum Nachlesen",
    copy: "Compose beschreibt PostgreSQL, den Migrationsschritt, persistente Volumes und Healthchecks. Das Dockerfile zeigt den Produktions-Build und den unprivilegierten Laufzeitbenutzer.",
    links: [
      {
        label: "docker-compose.yml",
        href: `${githubUrl}/blob/main/docker-compose.yml`,
      },
      { label: "Dockerfile", href: `${githubUrl}/blob/main/Dockerfile` },
      { label: "Installationsskript", href: `${githubUrl}/blob/main/scripts/install.sh` },
      { label: "Dokploy", href: dokployDeployUrl },
      { label: "Coolify", href: coolifyDeployUrl },
    ],
  },
  {
    icon: Braces,
    eyebrow: "Schnittstelle",
    title: "OpenAPI 3.1 eingecheckt",
    copy: "Der maschinenlesbare Vertrag beschreibt die versionierte Bearer-Token-API direkt neben der Implementierung.",
    links: [
      {
        label: "OpenAPI YAML ansehen",
        href: `${githubUrl}/blob/main/public/openapi.yaml`,
      },
    ],
  },
  {
    icon: Smartphone,
    eyebrow: "Native App",
    title: "iOS-Code im selben Projekt",
    copy: "SwiftUI-Oberfläche, Kamera-, Scan-, Upload- und API-Code der nativen App liegen unter ios/Inventory.",
    links: [
      {
        label: "iOS-Quellen öffnen",
        href: `${githubUrl}/tree/main/ios/Inventory`,
      },
    ],
  },
  {
    icon: Eye,
    eyebrow: "iOS-Datenschutz",
    title: "Privacy Manifest prüfbar",
    copy: "Das eingecheckte Apple Privacy Manifest deklariert kein Tracking, keine Tracking-Domains und keine gesammelten Datentypen. Es ist ein Quellbeleg, kein unabhängiges Datenschutzaudit.",
    links: [
      {
        label: "PrivacyInfo.xcprivacy",
        href: `${githubUrl}/blob/main/ios/Inventory/Inventory/PrivacyInfo.xcprivacy`,
      },
    ],
  },
  {
    icon: Database,
    eyebrow: "Datenmodell",
    title: "Migrationen sind versioniert",
    copy: "Die Änderungen am PostgreSQL-Schema liegen als nachvollziehbare SQL-Dateien im Repository.",
    links: [
      {
        label: "Migrationen ansehen",
        href: `${githubUrl}/tree/main/db/migrations`,
      },
    ],
  },
  {
    icon: Workflow,
    eyebrow: "Qualität",
    title: "Tests liegen neben dem Code",
    copy: "Der Tests-Ordner enthält automatisierbare Vertrags- und Verhaltensprüfungen für zentrale Serverfunktionen.",
    links: [
      { label: "Tests ansehen", href: `${githubUrl}/tree/main/tests` },
    ],
  },
];

function ArchitecturePreview() {
  return (
    <div className="overflow-hidden rounded-[26px] border border-white/10 bg-[#17181d] shadow-[0_36px_90px_rgba(0,0,0,0.35)]">
      <div className="flex h-11 items-center border-b border-white/10 px-4">
        <div className="flex gap-1.5">
          <span className="size-2 rounded-full bg-[#ff6a64]" />
          <span className="size-2 rounded-full bg-[#f7c84d]" />
          <span className="size-2 rounded-full bg-[#67d68c]" />
        </div>
        <span className="ml-3 font-mono text-[9px] text-white/45">open-inventory.stack</span>
        <span className="ml-auto rounded-full bg-[#18362b] px-2 py-1 font-mono text-[8px] text-[#8ff0cc]">
          healthy
        </span>
      </div>
      <div className="p-4 sm:p-5">
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            [Globe2, "Web-App", "Next.js"],
            [Smartphone, "iOS-App", "SwiftUI"],
            [Braces, "Integrationen", "OpenAPI 3.1"],
          ].map(([Icon, title, tech]) => {
            const PreviewIcon = Icon as LucideIcon;
            return (
              <div key={title as string} className="rounded-xl border border-white/10 bg-white/[0.045] p-3">
                <PreviewIcon className="size-4 text-[#a69fff]" aria-hidden="true" />
                <p className="mt-5 text-[10px] font-semibold text-white">{title as string}</p>
                <p className="mt-1 font-mono text-[8px] text-white/35">{tech as string}</p>
              </div>
            );
          })}
        </div>

        <div className="mx-auto h-5 w-px bg-white/15" />
        <div className="rounded-xl border border-[#665cff]/35 bg-[#27243f] p-3.5">
          <div className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-lg bg-[#665cff] text-white">
              <Container className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-[10px] font-semibold text-white">Open Inventory</p>
              <p className="mt-0.5 font-mono text-[8px] text-white/38">auth · api · jobs · migrations</p>
            </div>
            <span className="ml-auto font-mono text-[8px] text-[#8ff0cc]">:3000</span>
          </div>
        </div>
        <div className="mx-auto h-5 w-px bg-white/15" />

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.045] p-3.5">
            <Database className="size-4 text-[#8ff0cc]" aria-hidden="true" />
            <p className="mt-4 text-[10px] font-semibold text-white">PostgreSQL</p>
            <p className="mt-1 font-mono text-[8px] text-white/35">inventory_postgres</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.045] p-3.5">
            <HardDrive className="size-4 text-[#8ff0cc]" aria-hidden="true" />
            <p className="mt-4 text-[10px] font-semibold text-white">Lokale Uploads</p>
            <p className="mt-1 font-mono text-[8px] text-white/35">inventory_uploads</p>
          </div>
        </div>
      </div>
      <p className="border-t border-white/10 px-5 py-3 font-mono text-[8px] text-white/28">
        Beispielarchitektur · optionale externe Provider nicht dargestellt
      </p>
    </div>
  );
}

function BoundaryRow({
  icon: Icon,
  name,
  defaultValue,
  optional,
}: {
  icon: LucideIcon;
  name: string;
  defaultValue: string;
  optional: string;
}) {
  return (
    <div className="grid gap-4 border-b border-border py-5 last:border-0 md:grid-cols-[40px_0.65fr_1fr_1fr] md:items-start">
      <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold md:pt-2">{name}</p>
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-success">Im Kernbetrieb</p>
        <p className="mt-1.5 text-[13px] leading-6 text-muted">{defaultValue}</p>
      </div>
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-warning">Optional extern</p>
        <p className="mt-1.5 text-[13px] leading-6 text-muted">{optional}</p>
      </div>
    </div>
  );
}

export default function OpenSourcePage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <MarketingHeader />

      <main>
        <section className="relative overflow-hidden bg-[#111216] text-white">
          <div className="pointer-events-none absolute -left-24 top-24 size-[430px] rounded-full bg-[#8ff0cc]/13 blur-[130px]" />
          <div className="pointer-events-none absolute right-[5%] top-16 size-[480px] rounded-full bg-[#665cff]/27 blur-[140px]" />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:58px_58px] [mask-image:linear-gradient(to_bottom,black,transparent_92%)]" />

          <div className="relative mx-auto grid max-w-[1240px] items-center gap-16 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[0.92fr_1.08fr] lg:gap-14">
            <div className="max-w-[640px]">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#8ff0cc]/20 bg-[#8ff0cc]/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#8ff0cc]">
                <Github className="size-3.5" aria-hidden="true" />
                MIT Open Source
              </div>
              <h1 className="mt-7 text-[clamp(3.4rem,6.8vw,6.35rem)] font-semibold leading-[0.9] tracking-[-0.075em]">
                Dein Bestand.
                <span className="block text-[#9188ff]">Dein Stack.</span>
                Dein Code.
              </h1>
              <p className="mt-7 max-w-[580px] text-[17px] leading-8 text-white/53 sm:text-[19px]">
                Open Inventory ist offen, selbst betreibbar und dokumentiert –
                von Docker und PostgreSQL bis zur nativen iOS-App und
                OpenAPI-Schnittstelle.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href={githubUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-white px-5 text-sm font-semibold text-[#17181d] transition hover:-translate-y-0.5 hover:bg-white/90"
                >
                  <Github className="size-[17px]" aria-hidden="true" />
                  Repository öffnen
                </a>
                <Link
                  href="/docs#docker"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] border border-white/15 bg-white/[0.06] px-5 text-sm font-semibold transition hover:-translate-y-0.5 hover:bg-white/10"
                >
                  Self-hosting starten
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[11px] font-semibold text-white/48">
                {["MIT-Lizenz", "Docker Compose", "PostgreSQL", "OpenAPI 3.1"].map((item) => (
                  <span key={item} className="inline-flex items-center gap-1.5">
                    <Check className="size-3 text-[#8ff0cc]" strokeWidth={2.6} aria-hidden="true" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <ArchitecturePreview />
          </div>
        </section>

        <section className="border-b border-border bg-surface py-20 sm:py-24">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {principles.map(({ icon: Icon, title, copy }) => (
                <article key={title} className="rounded-[22px] border border-border bg-background p-6">
                  <Icon className="size-5 text-brand" strokeWidth={1.9} aria-hidden="true" />
                  <h2 className="mt-8 text-xl font-semibold tracking-[-0.035em]">{title}</h2>
                  <p className="mt-3 text-[13px] leading-6 text-muted">{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-border py-20 sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="grid items-end gap-8 lg:grid-cols-[1fr_0.68fr]">
              <div className="max-w-3xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                  Belege statt Versprechen
                </p>
                <h2 className="mt-4 text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] sm:text-[58px]">
                  Prüfe die Grundlage direkt im Repository.
                </h2>
              </div>
              <p className="text-[15px] leading-7 text-muted">
                Lizenz, Betriebsdefinition, API-Vertrag, native App, Migrationen
                und Tests sind keine Marketinggrafik. Die folgenden Links führen
                zu den jeweiligen Quelldateien und Verzeichnissen.
              </p>
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {evidence.map(({ icon: Icon, eyebrow, title, copy, links }) => (
                <article
                  key={title}
                  className="flex min-h-[250px] flex-col rounded-[22px] border border-border bg-surface p-6"
                >
                  <div className="flex items-center justify-between gap-4">
                    <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
                      <Icon className="size-[18px]" aria-hidden="true" />
                    </span>
                    <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted">
                      {eyebrow}
                    </span>
                  </div>
                  <h3 className="mt-7 text-[19px] font-semibold tracking-[-0.035em]">
                    {title}
                  </h3>
                  <p className="mt-2 text-[13px] leading-6 text-muted">{copy}</p>
                  <div className="mt-auto flex flex-wrap gap-x-4 gap-y-2 pt-6">
                    {links.map((link) => (
                      <a
                        key={link.href}
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand transition hover:text-brand-hover"
                      >
                        {link.label}
                        <ArrowUpRight className="size-3.5" aria-hidden="true" />
                      </a>
                    ))}
                  </div>
                </article>
              ))}
            </div>

            <p className="mt-5 text-xs leading-6 text-muted">
              Die verlinkten Dateien zeigen den Stand des Codes. Sie ersetzen
              weder eine eigene Betriebsprüfung noch eine unabhängige
              Sicherheits- oder Datenschutzbewertung.
            </p>
          </div>
        </section>

        <section className="py-20 sm:py-28">
          <div className="mx-auto grid max-w-[1240px] gap-14 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                MIT-Lizenz
              </p>
              <h2 className="mt-4 text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] sm:text-[56px]">
                Offen heißt: nachlesen, ändern, weiterbauen.
              </h2>
              <p className="mt-6 text-[16px] leading-7 text-muted">
                Die kurze, etablierte MIT-Lizenz erlaubt private und
                kommerzielle Nutzung, Veränderung und Weitergabe. Der
                Lizenz- und Copyright-Hinweis bleibt dabei erhalten; die
                Software kommt ohne Gewährleistung.
              </p>
              <a
                href={`${githubUrl}/blob/main/LICENSE`}
                target="_blank"
                rel="noreferrer"
                className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-brand transition hover:text-brand-hover"
              >
                Lizenztext auf GitHub lesen
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </a>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                [Eye, "Code prüfen", "Auditiere den Ablauf oder lasse ihn von deinem Team und externen Fachleuten prüfen."],
                [Code2, "Code anpassen", "Passe Oberfläche, Workflows und Integrationen an die realen Prozesse deiner Organisation an."],
                [Server, "Selbst betreiben", "Wähle Hosting, Domain, Backupstrategie und Updatefenster passend zu deinen Anforderungen."],
                [GitPullRequest, "Verbesserungen teilen", "Melde Fehler, diskutiere Änderungen oder reiche einen Pull Request im offenen Projekt ein."],
              ].map(([Icon, title, copy]) => {
                const CardIcon = Icon as LucideIcon;
                return (
                  <article key={title as string} className="rounded-[22px] border border-border bg-surface p-6">
                    <CardIcon className="size-5 text-success" aria-hidden="true" />
                    <h3 className="mt-8 text-[18px] font-semibold tracking-[-0.03em]">{title as string}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted">{copy as string}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-surface py-20 sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="grid items-end gap-8 lg:grid-cols-[1fr_0.7fr]">
              <div className="max-w-3xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                  Ehrliche Datengrenzen
                </p>
                <h2 className="mt-4 text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] sm:text-[58px]">
                  Self-hosted ist Kontrolle – nicht automatisch „nur lokal“.
                </h2>
              </div>
              <p className="text-[15px] leading-7 text-muted">
                Der Kern läuft auf deiner Infrastruktur. Welche externen Dienste
                Daten erhalten, hängt von deiner Konfiguration und den bewusst
                genutzten Funktionen ab.
              </p>
            </div>

            <div className="mt-12 rounded-[24px] border border-border bg-background px-5 sm:px-7">
              <BoundaryRow
                icon={Database}
                name="Bestandsdaten"
                defaultValue="Die Anwendung schreibt strukturierte Daten in die von dir konfigurierte PostgreSQL-Datenbank."
                optional="Ein extern betriebener PostgreSQL-Dienst ist möglich, wenn du dessen URL selbst konfigurierst."
              />
              <BoundaryRow
                icon={HardDrive}
                name="Dateien & Medien"
                defaultValue="Das Docker-Setup kann Uploads in einem persistenten lokalen Volume speichern."
                optional="Openinary kann als externer Speicherprovider gewählt werden und erhält dann die übertragenen Medien."
              />
              <BoundaryRow
                icon={Sparkles}
                name="KI-Funktionen"
                defaultValue="Ohne konfigurierte Provider-Schlüssel bleiben Analyse, Fotozählung, Übersetzung und Cover-Erstellung deaktiviert."
                optional="Bei bewusster Nutzung gehen relevante Bilder oder Inhalte an den konfigurierten OpenAI-kompatiblen, Google- oder Replicate-Dienst."
              />
              <BoundaryRow
                icon={Globe2}
                name="Karten"
                defaultValue="Ohne Mapbox-Token nutzt die Karte konfigurierte tokenfreie Straßen- und Satellitenquellen."
                optional="Kartenkacheln kommen dennoch aus externen Diensten; Mapbox oder eigene URLs lassen sich explizit konfigurieren."
              />
              <BoundaryRow
                icon={KeyRound}
                name="Anmeldung"
                defaultValue="Lokale, datenbankgestützte Konten und Rollen funktionieren ohne externen Identity-Provider."
                optional="Auth0 kann bewusst ergänzt werden; Anmeldeinformationen durchlaufen dann diesen externen Dienst."
              />
            </div>

            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-info-border bg-info-soft p-4 text-[13px] leading-6 text-info">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Die Open-Source-Dokumentation benennt diese Grenzen. Für deinen
              Betrieb bleiben Datenschutzprüfung, Secrets, TLS, Backups,
              Updates und die Auswahl vertrauenswürdiger Provider bei dir.
            </div>
          </div>
        </section>

        <section id="docker" className="scroll-mt-24 py-20 sm:py-28">
          <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
            <div className="grid items-center gap-14 lg:grid-cols-[0.82fr_1.18fr]">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                  Docker, Dokploy & Coolify
                </p>
                <h2 className="mt-4 text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] sm:text-[56px]">
                  Drei einfache Wege zum eigenen Stack.
                </h2>
                <p className="mt-6 text-[16px] leading-7 text-muted">
                  Auf einem Docker-Host übernimmt das Installationsskript
                  Secrets, Erstzugang und Compose-Start. Für Dokploy und Coolify
                  liegen gleichwertige, katalogfertige Importvorlagen bereit.
                </p>
                <div className="mt-7 space-y-3">
                  {[
                    "PostgreSQL, Migrationen, Healthcheck und persistente Volumes sind enthalten",
                    "Das Installationsskript erzeugt Secrets und das Bootstrap-Passwort automatisch",
                    "Der Produktionsprozess läuft im Container als unprivilegierter Benutzer",
                    "PostgreSQL und Uploads gemeinsam und regelmäßig sichern",
                  ].map((item) => (
                    <p key={item} className="flex items-start gap-2.5 text-sm leading-6 text-muted">
                      <Check className="mt-1 size-3.5 shrink-0 text-success" strokeWidth={2.6} aria-hidden="true" />
                      {item}
                    </p>
                  ))}
                </div>
              </div>

              <div className="overflow-hidden rounded-[24px] border border-white/10 bg-[#17181d] shadow-[0_26px_70px_rgba(24,20,38,0.22)]">
                <div className="flex h-12 items-center border-b border-white/10 px-4">
                  <div className="flex gap-1.5">
                    <span className="size-2 rounded-full bg-[#ff6a64]" />
                    <span className="size-2 rounded-full bg-[#f7c84d]" />
                    <span className="size-2 rounded-full bg-[#67d68c]" />
                  </div>
                  <span className="ml-3 font-mono text-[9px] text-white/42">Docker-Schnellstart</span>
                  <div className="ml-auto">
                    <CopyInstallCommand command={quickStartCommand} />
                  </div>
                </div>
                <pre className="overflow-x-auto p-5 font-mono text-[12px] leading-7 text-white/72 sm:p-7">
                  <code>
                    <span className="text-[#8ff0cc]">$ </span>
                    git clone {githubUrl}.git{"\n"}
                    <span className="text-[#8ff0cc]">$ </span>
                    cd inventory{"\n"}
                    <span className="text-[#8ff0cc]">$ </span>
                    ./scripts/install.sh
                  </code>
                </pre>
                <p className="border-t border-white/10 px-5 py-3 text-[9px] leading-5 text-white/38">
                  Das Terminal zeigt die Admin-E-Mail und das automatisch
                  erzeugte Bootstrap-Passwort. Nach dem ersten Login das
                  Passwort unter Einstellungen → Benutzer ändern.
                </p>
              </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {[
                {
                  title: "Dokploy einmal importieren",
                  copy: "Die vorbereitete Vorlage enthält Anwendung, PostgreSQL, persistente Uploads und Healthcheck und ist katalogfertig.",
                  href: dokployDeployUrl,
                  label: "Zum Dokploy-Verzeichnis",
                },
                {
                  title: "Coolify einmal importieren",
                  copy: "Die gleichwertige Service-Definition enthält dasselbe App-, Datenbank- und Speichermodell und ist katalogfertig.",
                  href: coolifyDeployUrl,
                  label: "Zum Coolify-Verzeichnis",
                },
              ].map((option) => (
                <article key={option.title} className="rounded-[22px] border border-border bg-surface p-6">
                  <Container className="size-5 text-brand" aria-hidden="true" />
                  <h3 className="mt-6 text-lg font-semibold tracking-[-0.03em]">{option.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{option.copy}</p>
                  <a href={option.href} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-brand transition hover:text-brand-hover">
                    {option.label}
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </a>
                </article>
              ))}
            </div>

            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-success-border bg-success-soft p-4 text-[13px] leading-6 text-success">
              <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Beim Docker-Schnellstart lautet die Standard-E-Mail
              <code className="font-mono text-[12px]">admin@inventory.local</code>.
              Dokploy und Coolify legen das generierte Passwort als Secret in
              ihrer Umgebungsansicht ab. Open Inventory hasht den Bootstrap-Wert
              vor dem Serverstart und entfernt den Klartext aus dem laufenden
              Prozess. Nach dem ersten Login das Passwort ändern; der
              Bootstrap-Zugang kann ein vorhandenes Konto nicht ersetzen.
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-[#17181d] py-20 text-white sm:py-28">
          <div className="mx-auto grid max-w-[1240px] gap-14 px-5 sm:px-8 lg:grid-cols-[0.78fr_1.22fr]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ff0cc]">
                Offene Schnittstelle
              </p>
              <h2 className="mt-4 text-[42px] font-semibold leading-[0.98] tracking-[-0.06em] sm:text-[56px]">
                Nicht nur Open Source. Auch offen integrierbar.
              </h2>
              <p className="mt-6 text-[15px] leading-7 text-white/50">
                Der OpenAPI-Vertrag liegt als YAML im Repository und wird von
                einer laufenden Instanz auch als JSON bereitgestellt.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row lg:flex-col lg:items-start">
                <Link
                  href="/api-docs"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[13px] bg-white px-4 text-sm font-semibold text-[#17181d] transition hover:-translate-y-0.5"
                >
                  Interaktive API-Referenz
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/openapi.yaml"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[13px] border border-white/15 px-4 text-sm font-semibold transition hover:bg-white/[0.06]"
                >
                  OpenAPI YAML
                  <FileCode2 className="size-4" aria-hidden="true" />
                </Link>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                [Braces, "OpenAPI 3.1", "Maschinenlesbarer Vertrag für Ressourcen, Lager, Scans, Freigaben, Rollen und weitere API-Bereiche."],
                [KeyRound, "Begrenzte Tokens", "Tokens sind gehasht, mit Scopes versehen, optional befristet und widerrufbar."],
                [LockKeyhole, "Zwei Schutzebenen", "Token-Scopes begrenzen den Transport; Rollen und bedingte Regeln bleiben die fachliche Zugriffskontrolle."],
                [Workflow, "Sichere Wiederholungen", "Idempotente Mutationen schützen wichtige Erfassungs-, Lager- und iOS-Abläufe vor doppelter Ausführung."],
              ].map(([Icon, title, copy]) => {
                const ApiIcon = Icon as LucideIcon;
                return (
                  <article key={title as string} className="rounded-[20px] border border-white/10 bg-white/[0.045] p-5">
                    <ApiIcon className="size-5 text-[#9188ff]" aria-hidden="true" />
                    <h3 className="mt-8 text-[17px] font-semibold">{title as string}</h3>
                    <p className="mt-2 text-[13px] leading-6 text-white/46">{copy as string}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="py-20 sm:py-28">
          <div className="mx-auto flex max-w-[940px] flex-col items-center px-5 text-center sm:px-8">
            <span className="grid size-14 place-items-center rounded-2xl bg-brand-solid text-on-brand shadow-[0_14px_35px_rgba(81,71,217,0.25)]">
              <Heart className="size-6" aria-hidden="true" />
            </span>
            <p className="mt-7 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
              Offen weiterentwickeln
            </p>
            <h2 className="mt-4 text-[42px] font-semibold leading-[1] tracking-[-0.06em] sm:text-[58px]">
              Nutze es. Prüfe es. Mach es besser.
            </h2>
            <p className="mt-6 max-w-2xl text-[16px] leading-7 text-muted">
              Open Inventory ist ein MIT-lizenziertes Open-Source-Projekt. Starte
              deine eigene Instanz oder bring dich mit einem Issue oder Pull
              Request ein.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-brand-solid px-5 text-sm font-semibold text-on-brand transition hover:-translate-y-0.5 hover:bg-brand-hover"
              >
                <Github className="size-4" aria-hidden="true" />
                Auf GitHub öffnen
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </a>
              <Link
                href="/docs"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] border border-border bg-surface px-5 text-sm font-semibold transition hover:bg-surface-muted"
              >
                <BookOpenText className="size-4" aria-hidden="true" />
                Dokumentation lesen
              </Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
