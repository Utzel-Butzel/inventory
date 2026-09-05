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
  organizationId?: string;
  organizationSlug: string;
  isReadOnly: boolean;
  allowNegativeStock: boolean;
};

const OrganizationRoutingContext =
  createContext<OrganizationRoutingContextValue | null>(null);

export function OrganizationRoutingProvider({
  organizationId,
  organizationSlug,
  isReadOnly = false,
  allowNegativeStock = false,
  children,
}: {
  organizationId?: string;
  organizationSlug: string;
  isReadOnly?: boolean;
  allowNegativeStock?: boolean;
  children: ReactNode;
}) {
  return (
    <OrganizationRoutingContext.Provider
      value={{ organizationId, organizationSlug, isReadOnly, allowNegativeStock }}
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

export function useOrganizationId() {
  return useOrganizationRouting().organizationId;
}

export function useOrganizationReadOnly() {
  return useOrganizationRouting().isReadOnly;
}

export function useOrganizationAllowsNegativeStock() {
  return useOrganizationRouting().allowNegativeStock;
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

function stripOrganizationHref(href: string) {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const suffixIndex = href.search(/[?#]/);
  const pathname = suffixIndex >= 0 ? href.slice(0, suffixIndex) : href;
  const suffix = suffixIndex >= 0 ? href.slice(suffixIndex) : "";
  const internalPathname = stripOrganizationPathname(pathname);
  return `${internalPathname === "/" ? "/inventory" : internalPathname}${suffix}`;
}

export function OrganizationLink({
  as,
  href,
  ...props
}: OrganizationLinkProps) {
  const organizationHref = useOrganizationHref();

  if (typeof href === "string") {
    const internalHref = stripOrganizationHref(href);
    const scopedHref = organizationHref(internalHref);
    return (
      <Link
        href={internalHref}
        as={as ?? (scopedHref === internalHref ? undefined : scopedHref)}
        {...props}
      />
    );
  }

  if (href.pathname && typeof href.pathname === "string") {
    const strippedPathname = stripOrganizationPathname(href.pathname);
    const internalPathname =
      strippedPathname === "/" ? "/inventory" : strippedPathname;
    const scopedPathname = organizationHref(internalPathname);
    const internalHref = { ...href, pathname: internalPathname };
    const scopedHref = { ...href, pathname: scopedPathname };
    return (
      <Link
        href={internalHref}
        as={as ?? (scopedPathname === internalPathname ? undefined : scopedHref)}
        {...props}
      />
    );
  }

  return <Link href={href} as={as} {...props} />;
}
