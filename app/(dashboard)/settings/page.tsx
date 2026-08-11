import type { Metadata } from "next";
import Link from "next/link";
import { FileCode2 } from "lucide-react";

import { ApiTokenManager } from "@/components/api-token-manager";
import { CustomFieldManager } from "@/components/custom-field-manager";
import { InventoryTypeManager } from "@/components/inventory-type-manager";
import { UserManager } from "@/components/user-manager";
import { getSessionIdentity } from "@/lib/api-auth";

export const metadata: Metadata = {
  title: "Settings | Inventory",
  description: "Manage runtime integrations and API access.",
};

export default async function SettingsPage() {
  const identity = await getSessionIdentity();
  const isAdmin = identity?.role === "admin";

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
          Workspace
        </p>
        <h1 className="text-3xl font-semibold tracking-[-0.035em] text-zinc-950 sm:text-4xl">
          Settings
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500 sm:text-base">
          Check enabled services, manage workspace access, and configure
          scoped credentials for integrations.
        </p>
        </div>
        <Link
          href="/api-docs"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50"
        >
          <FileCode2 className="size-4" /> API documentation
        </Link>
      </div>

      <div className="space-y-8">
        {isAdmin ? <InventoryTypeManager /> : null}
        {isAdmin ? <CustomFieldManager /> : null}
        {isAdmin ? <UserManager /> : null}
        <ApiTokenManager isAdmin={isAdmin} />
      </div>
    </main>
  );
}
