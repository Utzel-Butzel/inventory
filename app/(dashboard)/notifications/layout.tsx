import { redirect } from "next/navigation";

import { SettingsSectionLayout } from "@/components/settings-section-layout";
import { getSessionIdentity } from "@/lib/api-auth";

export default async function NotificationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await getSessionIdentity();
  if (!identity) redirect("/login");

  return (
    <SettingsSectionLayout permissions={identity.permissions}>
      {children}
    </SettingsSectionLayout>
  );
}
