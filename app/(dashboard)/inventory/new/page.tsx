import { ResourceEditor } from "@/components/resource-editor";
import { getSessionIdentity } from "@/lib/api-auth";
import { organizationPath } from "@/lib/organization-path";
import { redirect } from "next/navigation";

export default async function NewInventoryItemPage() {
  const identity = await getSessionIdentity();
  if (!identity) redirect("/login");
  if (!identity.permissions.includes("inventory.create")) {
    redirect(organizationPath(identity.organization.slug, "/inventory"));
  }

  return (
    <ResourceEditor
      canUseAi={identity.permissions.some((permission) => permission.startsWith("ai."))}
      canAnalyzeAi={identity.permissions.includes("ai.analyze")}
      canResearchAi={identity.permissions.includes("ai.research")}
      canGenerateImagesAi={identity.permissions.includes("ai.images")}
      canManageSpatial={identity.permissions.includes("spatial.manage")}
    />
  );
}
