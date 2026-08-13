import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { UiI18nProvider } from "@/components/ui-i18n-provider";
import { getSessionIdentity } from "@/lib/api-auth";
import { getResources, getT } from "@/lib/ui-i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("shell");
  const title = t("metadata.title");
  const description = t("metadata.description");
  return {
    title: {
      default: title,
      template: t("metadata.template"),
    },
    description,
    applicationName: t("brand"),
    robots: { index: false, follow: false },
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [identity, translation] = await Promise.all([
    getSessionIdentity(),
    getT(),
  ]);
  if (!identity) redirect("/login");
  const resources = getResources(translation.i18n);

  return (
    <UiI18nProvider language={translation.lng} resources={resources}>
      <AppShell
        user={{
          name: identity.name,
          email: identity.subject,
          role: identity.role ?? "viewer",
          roleName: identity.roleName ?? identity.role ?? "Viewer",
          permissions: identity.permissions,
          scopes: identity.scopes,
        }}
      >
        {children}
      </AppShell>
    </UiI18nProvider>
  );
}
