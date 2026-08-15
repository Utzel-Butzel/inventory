import "next-auth";

type InventoryUserRole = string;
type InventoryAuthProvider = "local" | "auth0" | "demo";

declare module "next-auth" {
  interface User {
    role?: InventoryUserRole;
    authProvider?: InventoryAuthProvider;
    sessionVersion?: number;
    auth0EmailVerified?: boolean;
  }

  interface Session {
    user: {
      id: string;
      role: InventoryUserRole;
      authProvider: InventoryAuthProvider;
      sessionVersion: number;
      auth0EmailVerified: boolean;
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
    auth0EmailVerified?: boolean;
  }
}
