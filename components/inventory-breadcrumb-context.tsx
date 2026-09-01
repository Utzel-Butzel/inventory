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

  useEffect(() => {
    if (!setItem || !href || !name) return;

    setItem({ href, name });
    return () => {
      setItem((current) => (current?.href === href ? null : current));
    };
  }, [href, name, setItem]);
}

export function InventoryBreadcrumb(item: InventoryBreadcrumbItem) {
  useInventoryBreadcrumb(item);
  return null;
}
