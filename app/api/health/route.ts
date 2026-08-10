import { access, constants, readdir } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { getStorageProvider } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const migrationsDirectory = path.resolve(process.cwd(), "db/migrations");
    const expectedMigrations = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const appliedRows = await db.execute(sql`select name from schema_migrations`);
    const appliedMigrations = new Set(
      appliedRows.map((row) => String((row as { name: unknown }).name)),
    );
    if (
      expectedMigrations.length === 0 ||
      expectedMigrations.some((migration) => !appliedMigrations.has(migration))
    ) {
      throw new Error("Database migrations are not current.");
    }

    if (getStorageProvider() === "local") {
      const uploadDirectory = path.resolve(
        process.env.STORAGE_LOCAL_PATH ?? path.join(process.cwd(), "data/uploads"),
      );
      await access(uploadDirectory, constants.R_OK | constants.W_OK);
    } else if (!process.env.OPENINARY_BASE_URL || !process.env.OPENINARY_API_KEY) {
      throw new Error("Openinary storage is not configured.");
    }

    return Response.json(
      {
        status: "ok",
        checks: { database: "ok", migrations: "ok", storage: "ok" },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
