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

type OrganizationRoutingContextValue = {
  organizationId: string;
  isReadOnly: boolean;
};

const OrganizationRoutingContext =
  createContext<OrganizationRoutingContextValue | null>(null);

export function OrganizationRoutingProvider({
  organizationId,
  isReadOnly = false,
  children,
}: {
  organizationId: string;
  isReadOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <OrganizationRoutingContext.Provider value={{ organizationId, isReadOnly }}>
      {children}
    </OrganizationRoutingContext.Provider>
  );
}

export function useOrganizationId() {
  const organization = useContext(OrganizationRoutingContext);
  if (!organization) {
    throw new Error(
      "Organization routing must be used inside OrganizationRoutingProvider.",
    );
  }
  return organization.organizationId;
}

export function useOrganizationReadOnly() {
  const organization = useContext(OrganizationRoutingContext);
  if (!organization) {
    throw new Error(
      "Organization routing must be used inside OrganizationRoutingProvider.",
    );
  }
  return organization.isReadOnly;
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
