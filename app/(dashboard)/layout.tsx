import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { getSessionIdentity } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await getSessionIdentity();
  if (!identity) redirect("/login");

  return (
    <AppShell
      user={{
        name: identity.name,
        email: identity.subject,
        role: identity.role ?? "viewer",
      }}
    >
      {children}
    </AppShell>
  );
}
