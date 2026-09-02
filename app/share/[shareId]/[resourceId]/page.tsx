import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { PublicResourceView } from "@/components/public-share-view";
import { PublicShareLogin } from "@/components/public-stock-tool";
import {
  getActivePublicShare,
  getPublicSharedResource,
  getPublicStockSummary,
} from "@/lib/public-shares";
import {
  publicShareSessionCookieName,
  publicShareSessionIsValid,
} from "@/lib/public-share-session";
import { getT } from "@/lib/ui-i18n/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("share");
  const title = t("metadata.item");
  const description = t("metadata.itemDescription");
  return {
    title,
    description,
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

type Props = { params: Promise<{ shareId: string; resourceId: string }> };

export default async function PublicSharedItemPage({ params }: Props) {
  const { shareId, resourceId } = await params;
  const share = await getActivePublicShare(shareId);
  if (!share || share.scope !== "inventory") notFound();
  if (share.accessMode === "stock") {
    const token = (await cookies()).get(
      publicShareSessionCookieName(share.id),
    )?.value;
    if (!publicShareSessionIsValid(share, token)) {
      return <PublicShareLogin shareId={share.id} title={share.name} />;
    }
  }
  const result = await getPublicSharedResource(share, resourceId);
  if (!result) notFound();
  const stockTool =
    share.accessMode === "stock"
      ? await getPublicStockSummary(share, resourceId)
      : null;
  if (share.accessMode === "stock" && !stockTool) notFound();
  return (
    <PublicResourceView
      shareId={share.id}
      shareTitle={share.name}
      showBack
      resource={result.resource}
      definitions={result.definitions}
      stockTool={stockTool}
    />
  );
}
