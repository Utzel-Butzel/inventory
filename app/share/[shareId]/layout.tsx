import { UiI18nProvider } from "@/components/ui-i18n-provider";
import { getResources, getT } from "@/lib/ui-i18n/server";

export const dynamic = "force-dynamic";

export default async function PublicShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const translation = await getT();
  return (
    <UiI18nProvider
      language={translation.lng}
      resources={getResources(translation.i18n)}
    >
      {children}
    </UiI18nProvider>
  );
}
