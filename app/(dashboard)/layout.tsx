import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import type {
  ActiveOrganization,
  OrganizationMembershipSummary,
} from "@/components/organization-switcher";
import { UiI18nProvider } from "@/components/ui-i18n-provider";
import { getSessionIdentity } from "@/lib/api-auth";
import {
  organizationIdFromPathname,
  organizationPath,
  stripOrganizationPathname,
} from "@/lib/organization-path";
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
  const [identity, translation, requestHeaders] = await Promise.all([
    getSessionIdentity(),
    getT(),
    headers(),
  ]);
  if (!identity) redirect("/login");
  const organizationIdentity = identity as typeof identity & {
    organization?: ActiveOrganization | null;
    organizations?: OrganizationMembershipSummary[];
  };
  if (!organizationIdentity.organization) redirect("/login");
  const originalPath =
    requestHeaders.get("x-inventory-original-path") ?? "/dashboard";
  if (!organizationIdFromPathname(originalPath)) {
    const [pathname, query] = originalPath.split("?", 2);
    redirect(
      `${organizationPath(identity.organizationId, stripOrganizationPathname(pathname))}${query ? `?${query}` : ""}`,
    );
  }
  const organizations = organizationIdentity.organizations?.length
    ? organizationIdentity.organizations
    : [
        {
          ...organizationIdentity.organization,
          role: identity.role ?? "viewer",
          roleName: identity.roleName ?? identity.role ?? "Viewer",
        },
      ];
  const resources = getResources(translation.i18n);

  return (
    <UiI18nProvider language={translation.lng} resources={resources}>
      <AppShell
        organization={organizationIdentity.organization}
        organizations={organizations}
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
