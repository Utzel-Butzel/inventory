import "next-auth";

type InventoryUserRole = "admin" | "editor" | "viewer";
type InventoryAuthProvider = "local" | "auth0";

declare module "next-auth" {
  interface User {
    role?: InventoryUserRole;
    authProvider?: InventoryAuthProvider;
    sessionVersion?: number;
  }

  interface Session {
    user: {
      id: string;
      role: InventoryUserRole;
      authProvider: InventoryAuthProvider;
      sessionVersion: number;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    role?: InventoryUserRole;
    authProvider?: InventoryAuthProvider;
    sessionVersion?: number;
  }
}
