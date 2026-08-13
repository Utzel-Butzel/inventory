import type { Metadata } from "next";

import { NotificationInbox } from "@/components/notification-inbox";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("notifications");
  return { title: t("title"), description: t("description") };
}

export default function NotificationsPage() {
  return <NotificationInbox />;
}
