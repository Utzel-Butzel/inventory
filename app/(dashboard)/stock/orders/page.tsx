import { permanentRedirect } from "next/navigation";

import { getSessionIdentity } from "@/lib/api-auth";
import { organizationPath } from "@/lib/organization-path";

export default async function LegacyStockOrdersPage() {
  const identity = await getSessionIdentity();
  permanentRedirect(
    identity
      ? organizationPath(identity.organization.slug, "/operations/purchases")
      : "/login",
  );
}
