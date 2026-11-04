import { notFound } from "next/navigation";
import { getSessionIdentity } from "@/lib/api-auth";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata() {
  const { t } = await getT("labels");
  return { title: t("designer.eyebrow") };
}

export default async function LabelEditorPage() {
  const identity = await getSessionIdentity();
  if (!identity?.permissions.includes("labels.manage")) notFound();
  return null;
}
