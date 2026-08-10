import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://inventory:inventory@localhost:5432/inventory";

const globalDatabase = globalThis as unknown as {
  inventorySql?: ReturnType<typeof postgres>;
};

const sqlClient =
  globalDatabase.inventorySql ??
  postgres(databaseUrl, {
    max: process.env.NODE_ENV === "production" ? 10 : 4,
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalDatabase.inventorySql = sqlClient;
}

export const db = drizzle(sqlClient, { schema });
