# Local development

[Back to the README](../README.md)

Requirements: Node.js 22.13+, npm, and PostgreSQL 15+.

Create the development database once:

```bash
psql postgres -c "CREATE ROLE inventory LOGIN PASSWORD 'inventory';"
createdb --owner=inventory inventory
```

Then install and start the app:

```bash
npm ci
cp .env.example .env.local
npm run db:migrate
npm run db:seed       # optional sample data
npm run dev
```

For a local password login, add these values to `.env.local`:

```dotenv
BOOTSTRAP_ADMIN_EMAIL=admin@inventory.local
BOOTSTRAP_ADMIN_NAME=Inventory admin
BOOTSTRAP_ADMIN_PASSWORD=choose-a-local-only-password
```

Open [http://localhost:3000](http://localhost:3000).

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run generated-route and TypeScript checks |
| `npm run db:migrate` | Apply checked-in migrations |
| `npm run db:seed` | Add sample records to an empty workspace |
| `npm run db:generate` | Generate a Drizzle migration |
| `npm run db:tunnel` | Open an SSH tunnel to a remote PostgreSQL server |
| `npm run auth:hash -- "password"` | Generate a bcrypt password hash |
| `npm run deploy` | Build and upload the native iOS app to TestFlight |
| `npm run android:check` | Run Android unit tests and lint, and build the native debug APK |
| `npm run android:install` | Install the Android app on a connected device or emulator |

Focused contract and integration test commands are listed in
[`package.json`](../package.json).

## Map assets

MapLibre's worker and its shared module are copied from the installed package
into `public/vendor/maplibre/<version>/` by the `predev` and `prebuild` hooks.
Use `npm run dev` / `npm run build` (or their pnpm equivalents). When invoking
Next.js directly, run `node scripts/prepare-maplibre-assets.mjs` first.

## Project structure

| Path | Contents |
| --- | --- |
| `app/` | Next.js pages and API routes |
| `components/` | Web interface components |
| `lib/` | Domain logic and integrations |
| `db/` | Drizzle schema and PostgreSQL migrations |
| `ios/Inventory/` | Native SwiftUI client |
| `android/` | Native Kotlin / Jetpack Compose / Material 3 client |
| `deploy/` | Dokploy and Coolify templates |
| `public/openapi.yaml` | REST API contract |

The main stack is Next.js, React, TypeScript, Tailwind CSS, PostgreSQL, and
Drizzle ORM. Spatial views use MapLibre and Three.js.

## Native apps

- [iOS setup and TestFlight deployment](../ios/Inventory/README.md)
- [Android setup and feature parity](../android/README.md)
