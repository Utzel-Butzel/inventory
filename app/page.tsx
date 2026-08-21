import { redirect } from "next/navigation";

import { getSessionIdentity } from "@/lib/api-auth";
import { organizationPath } from "@/lib/organization-path";

export default async function HomePage() {
  const identity = await getSessionIdentity();
  redirect(identity ? organizationPath(identity.organization.slug, "/inventory") : "/login");
}
