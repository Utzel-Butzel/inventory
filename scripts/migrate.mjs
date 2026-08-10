import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  for (const envFile of [".env.local", ".env"]) {
    if (!existsSync(envFile)) continue;
    process.loadEnvFile(envFile);
    if (process.env.DATABASE_URL) break;
  }
}

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://inventory:inventory@localhost:5432/inventory";
const migrationsDirectory = path.resolve(process.cwd(), "db/migrations");
const sql = postgres(databaseUrl, { max: 1 });
const migrationLockId = 4_847_868_372;
let lockAcquired = false;

try {
  await sql`SELECT pg_advisory_lock(${migrationLockId})`;
  lockAcquired = true;

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamp with time zone DEFAULT now() NOT NULL
    )
  `;

  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const [existing] = await sql`
      SELECT name FROM schema_migrations WHERE name = ${file}
    `;
    if (existing) continue;

    const migration = await readFile(path.join(migrationsDirectory, file), "utf8");
    await sql.begin(async (transaction) => {
      await transaction.unsafe(migration);
      await transaction`
        INSERT INTO schema_migrations (name) VALUES (${file})
      `;
    });
    process.stdout.write(`Applied ${file}\n`);
  }
} finally {
  try {
    if (lockAcquired) {
      await sql`SELECT pg_advisory_unlock(${migrationLockId})`;
    }
  } finally {
    await sql.end();
  }
}
