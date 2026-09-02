import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import {
  PublicShareLogin,
  PublicStockCatalog,
} from "@/components/public-stock-tool";
import {
  PublicInventoryView,
  PublicResourceView,
} from "@/components/public-share-view";
import {
  getActivePublicShare,
  getPublicSharedResource,
  listPublicShareFilterOptions,
  listPublicShareResources,
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
  const title = t("metadata.collection");
  const description = t("metadata.collectionDescription");
  return {
    title,
    description,
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

type Props = {
  params: Promise<{ shareId: string }>;
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
};

export default async function PublicSharePage({ params, searchParams }: Props) {
  const [{ shareId }, parameters, { t }] = await Promise.all([
    params,
    searchParams,
    getT("share"),
  ]);
  const share = await getActivePublicShare(shareId);
  if (!share) notFound();

  if (share.accessMode === "stock") {
    const token = (await cookies()).get(
      publicShareSessionCookieName(share.id),
    )?.value;
    if (!publicShareSessionIsValid(share, token)) {
      return <PublicShareLogin shareId={share.id} title={share.name} />;
    }
    const [result, filters] = await Promise.all([
      listPublicShareResources({ share, page: 1 }),
      listPublicShareFilterOptions(share),
    ]);
    return (
      <PublicStockCatalog
        shareId={share.id}
        title={share.name}
        initialResult={{ ...result, filters }}
      />
    );
  }

  if (share.scope === "item") {
    const result = await getPublicSharedResource(share);
    if (!result) notFound();
    return (
      <PublicResourceView
        shareId={share.id}
        shareTitle={share.name}
        showBack={false}
        resource={result.resource}
        definitions={result.definitions}
      />
    );
  }

  const rawQuery = Array.isArray(parameters.q) ? parameters.q[0] : parameters.q;
  const query = rawQuery?.trim().slice(0, 240) ?? "";
  const rawPage = Array.isArray(parameters.page) ? parameters.page[0] : parameters.page;
  const parsedPage = /^\d{1,4}$/.test(rawPage ?? "")
    ? Number(rawPage)
    : 1;
  const result = await listPublicShareResources({
    share,
    query,
    page: parsedPage,
  });
  const publicFilterDefinition = share.filter
    ? result.definitions.find(
        (definition) => definition.key === share.filter?.fieldKey,
      )
    : null;
  const filterLabel = publicFilterDefinition ? t("collection.filtered") : null;
  return (
    <PublicInventoryView
      shareId={share.id}
      title={share.name}
      filterLabel={filterLabel}
      resources={result.resources}
      query={query}
      pagination={result.pagination}
    />
  );
}
