import "next-auth";

type InventoryUserRole = string;
type InventoryAuthProvider = string;

declare module "next-auth" {
  interface User {
    role?: InventoryUserRole;
    authProvider?: InventoryAuthProvider;
    sessionVersion?: number;
    externalEmailVerified?: boolean;
  }

  interface Session {
    user: {
      id: string;
      role: InventoryUserRole;
      authProvider: InventoryAuthProvider;
      sessionVersion: number;
      externalEmailVerified: boolean;
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
    externalEmailVerified?: boolean;
    /** Compatibility with sessions issued before external providers were generalized. */
    auth0EmailVerified?: boolean;
  }
}
