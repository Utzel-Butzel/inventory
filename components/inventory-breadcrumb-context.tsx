"use client";

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
} from "react";

export type InventoryBreadcrumbItem = {
  subtitle?: string | null;
  href: string;
  name: string;
};

const InventoryBreadcrumbContext = createContext<
  Dispatch<SetStateAction<InventoryBreadcrumbItem | null>> | null
>(null);

export function InventoryBreadcrumbProvider({
  children,
  setItem,
}: {
  children: ReactNode;
  setItem: Dispatch<SetStateAction<InventoryBreadcrumbItem | null>>;
}) {
  return (
    <InventoryBreadcrumbContext.Provider value={setItem}>
      {children}
    </InventoryBreadcrumbContext.Provider>
  );
}

export function useInventoryBreadcrumb(
  item: InventoryBreadcrumbItem | null,
) {
  const setItem = useContext(InventoryBreadcrumbContext);
  const href = item?.href;
  const name = item?.name;
  const subtitle = item?.subtitle;

  useEffect(() => {
    if (!setItem || !href || !name) return;

    setItem({ href, name, subtitle });
    return () => {
      setItem((current) => (current?.href === href ? null : current));
    };
  }, [href, name, subtitle, setItem]);
}

export function InventoryBreadcrumb(item: InventoryBreadcrumbItem) {
  useInventoryBreadcrumb(item);
  return null;
}
