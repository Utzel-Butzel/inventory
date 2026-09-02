import { SettingsNavigation } from "@/components/settings-navigation";
import type { AppPermission } from "@/lib/access-control-contract";

export function SettingsSectionLayout({
  children,
  isSuperAdmin,
  permissions,
}: {
  children: React.ReactNode;
  isSuperAdmin: boolean;
  permissions: AppPermission[];
}) {
  return (
    <div className="min-h-[calc(100dvh-68px)] md:grid md:grid-cols-[248px_minmax(0,1fr)]">
      <SettingsNavigation
        isSuperAdmin={isSuperAdmin}
        permissions={permissions}
      />
      <div className="min-w-0">
        <div className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </div>
    </div>
  );
}
