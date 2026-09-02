import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicActionFlow } from "@/components/public-action-flow";
import { UiI18nProvider } from "@/components/ui-i18n-provider";
import { getPublicActionFlow } from "@/lib/public-action-flows";
import { getResources, getT } from "@/lib/ui-i18n/server";

type Props = { params: Promise<{ triggerId: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { triggerId } = await params;
  const action = await getPublicActionFlow(triggerId);
  return {
    title: action?.view.name ?? "Action",
    description: action?.view.description || "Public inventory action",
    robots: { index: false, follow: false, noarchive: true },
    referrer: "no-referrer",
  };
}

export default async function PublicActionFlowPage({ params }: Props) {
  const { triggerId } = await params;
  const [action, translation] = await Promise.all([
    getPublicActionFlow(triggerId),
    getT(["scanner", "common"]),
  ]);
  if (!action) notFound();
  return (
    <UiI18nProvider
      language={translation.lng}
      resources={getResources(translation.i18n, ["scanner", "common"])}
    >
      <PublicActionFlow action={action.view} />
    </UiI18nProvider>
  );
}
