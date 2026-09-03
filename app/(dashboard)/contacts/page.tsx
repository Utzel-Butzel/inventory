import type { Metadata } from "next";

import { ContactsManager } from "@/components/contacts-manager";
import { getSessionIdentity } from "@/lib/api-auth";
import { getT } from "@/lib/ui-i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("contacts");
  return {
    title: t("metadata.title"),
    description: t("metadata.description"),
  };
}

export default async function ContactsPage() {
  const identity = await getSessionIdentity();
  return (
    <main className="mx-auto w-full max-w-[1540px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <ContactsManager
        canManage={Boolean(identity?.permissions.includes("contacts.manage"))}
      />
    </main>
  );
}
