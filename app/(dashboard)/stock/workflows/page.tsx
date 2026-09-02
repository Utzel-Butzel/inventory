import { permanentRedirect } from "next/navigation";

import { getSessionIdentity } from "@/lib/api-auth";
import { organizationPath } from "@/lib/organization-path";

export default async function StockWorkflowsPage() {
  const identity = await getSessionIdentity();
  permanentRedirect(
    identity
      ? organizationPath(identity.organization.slug, "/settings/action-flows")
      : "/login",
  );
}
