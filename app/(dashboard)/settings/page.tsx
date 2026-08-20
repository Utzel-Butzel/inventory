import { redirect } from "next/navigation";

import { getSessionIdentity } from "@/lib/api-auth";
import { organizationPath } from "@/lib/organization-path";

export default async function SettingsPage() {
  const identity = await getSessionIdentity();
  redirect(
    identity
      ? organizationPath(identity.organization.slug, "/settings/user")
      : "/login",
  );
}
