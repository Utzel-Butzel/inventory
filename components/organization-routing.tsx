"use client";

import Link, { type LinkProps } from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  type AnchorHTMLAttributes,
  type ReactNode,
  useCallback,
  useContext,
} from "react";

import {
  organizationPath,
  stripOrganizationPathname,
} from "@/lib/organization-path";

const OrganizationRoutingContext = createContext<string | null>(null);

export function OrganizationRoutingProvider({
  organizationId,
  children,
}: {
  organizationId: string;
  children: ReactNode;
}) {
  return (
    <OrganizationRoutingContext.Provider value={organizationId}>
      {children}
    </OrganizationRoutingContext.Provider>
  );
}

export function useOrganizationId() {
  const organizationId = useContext(OrganizationRoutingContext);
  if (!organizationId) {
    throw new Error(
      "Organization routing must be used inside OrganizationRoutingProvider.",
    );
  }
  return organizationId;
}

export function useOrganizationHref() {
  const organizationId = useOrganizationId();
  return useCallback(
    (href: string) => organizationPath(organizationId, href),
    [organizationId],
  );
}

export function useOrganizationPathname() {
  return stripOrganizationPathname(usePathname());
}

type OrganizationLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    children?: ReactNode;
  };

export function OrganizationLink({ href, ...props }: OrganizationLinkProps) {
  const organizationHref = useOrganizationHref();
  const scopedHref =
    typeof href === "string"
      ? organizationHref(href)
      : href.pathname && typeof href.pathname === "string"
        ? { ...href, pathname: organizationHref(href.pathname) }
        : href;
  return <Link href={scopedHref} {...props} />;
}
