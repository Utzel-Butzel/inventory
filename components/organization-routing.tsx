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
  organizationSlug: string;
  isReadOnly: boolean;
};

const OrganizationRoutingContext =
  createContext<OrganizationRoutingContextValue | null>(null);

export function OrganizationRoutingProvider({
  organizationSlug,
  isReadOnly = false,
  children,
}: {
  organizationSlug: string;
  isReadOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <OrganizationRoutingContext.Provider
      value={{ organizationSlug, isReadOnly }}
    >
      {children}
    </OrganizationRoutingContext.Provider>
  );
}

function useOrganizationRouting() {
  const organization = useContext(OrganizationRoutingContext);
  if (!organization) {
    throw new Error(
      "Organization routing must be used inside OrganizationRoutingProvider.",
    );
  }
  return organization;
}

export function useOrganizationSlug() {
  return useOrganizationRouting().organizationSlug;
}

export function useOrganizationReadOnly() {
  return useOrganizationRouting().isReadOnly;
}

export function useOrganizationHref() {
  const organizationSlug = useOrganizationSlug();
  return useCallback(
    (href: string) => organizationPath(organizationSlug, href),
    [organizationSlug],
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
