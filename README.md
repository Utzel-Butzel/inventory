<div align="center">
  <img src="./deploy/coolify/open-inventory.svg" width="96" alt="Open Inventory logo">

  <h1>Open Inventory</h1>

  <p><strong>Self-hosted inventory and stock management for teams, spaces, and physical things.</strong></p>

  <p>
    <a href="https://github.com/Utzel-Butzel/inventory/actions/workflows/deployment-check.yml"><img src="https://github.com/Utzel-Butzel/inventory/actions/workflows/deployment-check.yml/badge.svg" alt="Deployment check"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/github/license/Utzel-Butzel/inventory?color=665cff" alt="MIT License"></a>
    <a href="https://github.com/Utzel-Butzel/inventory/pkgs/container/inventory"><img src="https://img.shields.io/badge/container-GHCR-2496ED?logo=docker&logoColor=white" alt="GHCR container image"></a>
  </p>

  <p>
    <a href="#quick-start">Quick start</a> ·
    <a href="#features">Features</a> ·
    <a href="#api-and-integrations">API</a> ·
    <a href="#local-development">Development</a> ·
    <a href="#contributing">Contributing</a>
  </p>
</div>

Open Inventory helps you catalog equipment, supplies, collections, rooms, and
other physical assets. It combines flexible inventory records with auditable
stock workflows, mobile capture, maps, optional AI, a scoped REST API, and an
opt-in Model Context Protocol (MCP) endpoint.

Your data stays on infrastructure you control. The web app, API, migrations,
and native iOS app live in this repository; the public website and product
content live in [open-inventory-website](https://github.com/Utzel-Butzel/open-inventory-website).

## Features

| | |
| --- | --- |
| **Flexible inventory** | Custom types and fields, relationships, tags, media, variants, translations, and CSV/Excel/PDF exchange |
| **Traceable stock** | Bulk and serialized tracking, location balances, counts, assignments, reservations, bills of materials, and purchase orders |
| **Fast capture** | Camera batches, QR and barcode workflows, printable labels, duplicate detection, and a native iPhone app |
| **Maps and rooms** | GPS, GeoJSON points and polygons, spatial containment, LiDAR RoomPlan scans, and indoor 3D placement |
| **Optional AI** | Image analysis, item recognition, photo counting, cover generation, and content translation |
| **Built for teams** | Isolated organizations, custom roles, conditional access, Auth0, notifications, API tokens, and signed webhooks |

### Organizations

Users can belong to multiple isolated organizations and have a different role
in each one. Authenticated Webapp pages use a short, editable organization slug
as the first URL segment, for example
`https://inventory.example.com/workshop-berlin/inventory`. Legacy UUID URLs
redirect to the current slug, so existing links remain valid.
API and iOS clients select a membership with `X-Organization-ID`; standalone
API tokens remain pinned to the organization that issued them. Manage and
switch organizations under **Settings → Organization**.

Deployment superadmins configured with the comma-separated `SUPERADMIN_EMAILS`
environment variable can review and edit every workspace under **Settings →
All organizations**. Organization creation by regular signed-in users is off by
default; set `USERS_CAN_CREATE_ORGANIZATIONS=true` to enable it. Superadmins can
always create organizations from the deployment-wide page.

## Quick start

You need Git, Docker with Compose v2, OpenSSL, and `curl`.

```bash
git clone https://github.com/Utzel-Butzel/inventory.git
cd inventory
./scripts/install.sh
```

The installer generates unique secrets, starts PostgreSQL and Open Inventory,
runs migrations, waits for the health check, and prints the sign-in details.
Open [http://localhost:3000](http://localhost:3000) unless you selected another
URL.

> [!IMPORTANT]
> After the first sign-in, change the generated password under **Settings →
> Users**. Then remove `BOOTSTRAP_ADMIN_PASSWORD` and
> `BOOTSTRAP_ADMIN_PASSWORD_ONCE` from `.env` and restart the stack.

Use a different port or public URL when needed:

```bash
APP_PORT=8080 ./scripts/install.sh
AUTH_URL=https://inventory.example.com ./scripts/install.sh
```

The installer never overwrites an existing `.env`. Start an already configured
installation with:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

PostgreSQL data and uploads use persistent Docker volumes. Avoid
`docker compose down --volumes` unless you intend to delete both.

## Deployment options

### Docker Compose

The [quick start](#quick-start) is the recommended setup for a single server.
Put a TLS reverse proxy in front of it and set `AUTH_URL` to the exact public
origin.

### Dokploy

Import the ready-made PostgreSQL and app bundle using the
[Dokploy deployment guide](deploy/dokploy/README.md).

### Coolify

Paste the service definition from the
[Coolify deployment guide](deploy/coolify/README.md).

### iOS / TestFlight

The native iOS app is deployed with the repository's pinned Fastlane version.
After the one-time App Store Connect and Xcode signing setup described in the
[iOS deployment guide](ios/Inventory/README.md#testflight-deployment), deploy a
new build from the repository root with:

```bash
npm run deploy
```

This builds a signed IPA and uploads it to TestFlight. It does not submit an App
Store version for review. Use `npm run ios:check` for a local configuration
check of the project and shared scheme, or `npm run ios:build` to create the IPA
without uploading it.

Both platform templates include migrations, health checks, generated secrets,
and persistent database and upload volumes. They use the published
[`ghcr.io/utzel-butzel/inventory`](https://github.com/Utzel-Butzel/inventory/pkgs/container/inventory)
image.

<details>
<summary><strong>Common operations</strong></summary>

Verify the application and database are ready:

```bash
curl --fail http://localhost:3000/api/health
docker compose -f docker-compose.yml -f docker-compose.local.yml ps
```

Update a checkout:

```bash
git pull --ff-only
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
curl --fail http://localhost:3000/api/health
```

Back up the database and local uploads in the same maintenance window:

```bash
mkdir -p backups
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T db \
  pg_dump -U inventory -d inventory -Fc > backups/inventory.dump
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T app \
  tar -czf - -C /app/data/uploads . > backups/inventory-uploads.tar.gz
```

Store both backup files away from the Docker host and test restoring them.

</details>

## Configuration

The installer creates the required values. Optional services remain disabled
until configured in `.env`.

| Area | Main settings |
| --- | --- |
| Authentication | Local accounts by default; optional `AUTH0_*` and `AUTH_OIDC_*` providers; see [Authentication providers](AUTHPROVIDERS.md) |
| Storage | Persistent local files or `OPENINARY_*` |
| Maps | Token-free defaults or `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` |
| AI | `OPENAI_API_KEY` for inventory and room-photo analysis; optional `REPLICATE_API_TOKEN` or `GOOGLE_AI_API_KEY` |
| Notifications | In-app by default; optional SMTP, Web Push, Slack, Teams, or webhook delivery |
| Integrations | Scoped API tokens and HMAC-signed outgoing webhooks |

See [`.env.example`](.env.example) for the complete, commented reference.

MapLibre's worker and its shared module are copied from the installed package
into `public/vendor/maplibre/<version>/` by the `predev` and `prebuild` hooks.
Use `npm run dev` / `npm run build` (or their pnpm equivalents). When invoking
Next.js directly, run `node scripts/prepare-maplibre-assets.mjs` first.

### Authentication providers

Open Inventory uses Auth.js for browser sign-in and its own organization roles
for authorization. Deployments can offer local passwords, Auth0, and one
standards-based OpenID Connect provider such as Supabase or Keycloak.

See [Authentication provider configuration](AUTHPROVIDERS.md) for callback
URLs, environment variables, Docker instructions, account provisioning, safe
rollout guidance, and troubleshooting.

## Local development

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

### Useful commands

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

Focused contract and integration test commands are listed in
[`package.json`](package.json).

## API and integrations

Create a scoped token under **Settings → API access**, then use it as a bearer
credential:

```bash
curl "http://localhost:3000/api/v1/resources?pageSize=25" \
  -H "Authorization: Bearer inv_your_token"
```

Tokens can receive `read`, `write`, and `ai` scopes and can be revoked at any
time. A running installation exposes the machine-readable contract at
`/openapi.json`; set `WEBSITE_URL` to link the app to the separate website's
interactive documentation.

### Model Context Protocol (MCP)

The built-in stateless MCP server lets trusted agents search inventory, read
items and stock, list due counts, create or update items, and record stock
movements or physical counts. It is disabled by default. Enable it and apply
the database migration before connecting a client:

```bash
MCP_ENABLED=true npm run db:migrate
```

The endpoint is `https://your-inventory.example/mcp`. Configure the client with
an Inventory API token from **Settings → API access** as the bearer credential.
Do not add `X-Organization-ID`: MCP tokens are always pinned to the organization
that issued them. Grant only the token scopes and role permissions the agent
needs, and prefer a short expiry for external clients.

Every request is authenticated anew. Reads and writes have independent durable
rate limits, writes require an explicit confirmation argument, creation and
ledger writes require UUID idempotency keys, and item updates require the last
observed `updatedAt` value. The audit trail stores the tool, principal, result,
targets, timing, and a hash of the arguments—never the raw arguments or token.

`MCP_ALLOWED_HOSTS` defaults to the host in `AUTH_URL`. Browser-originated MCP
requests are rejected unless their exact origins are present in
`MCP_ALLOWED_ORIGINS`; normal server-to-server clients do not need that setting.
Use `MCP_REQUEST_RATE_LIMIT_PER_MINUTE`, `MCP_READ_RATE_LIMIT_PER_MINUTE`, and
`MCP_WRITE_RATE_LIMIT_PER_MINUTE` to adjust the defaults of 240, 120, and 30.
Audit argument fingerprints are HMAC-protected with `AUTH_SECRET`; set a
separate `MCP_AUDIT_HASH_SECRET` for independent key rotation.

This bearer-token mode is intended for trusted, self-hosted clients. A public
ChatGPT connector or marketplace distribution should add an OAuth 2.1/PKCE
authorization layer instead of distributing long-lived Inventory tokens.

- [OpenAPI specification](public/openapi.yaml)
- [Native iOS app and setup guide](ios/Inventory/README.md)
- Outgoing webhooks are configured under **Settings → Webhooks**

## Project structure

| Path | Contents |
| --- | --- |
| `app/` | Next.js pages and API routes |
| `components/` | Web interface components |
| `lib/` | Domain logic and integrations |
| `db/` | Drizzle schema and PostgreSQL migrations |
| `ios/Inventory/` | Native SwiftUI client |
| `deploy/` | Dokploy and Coolify templates |
| `public/openapi.yaml` | REST API contract |

The main stack is Next.js, React, TypeScript, Tailwind CSS, PostgreSQL, and
Drizzle ORM. Spatial views use MapLibre and Three.js.

## Contributing

Contributions and bug reports are welcome.

1. Create a focused branch.
2. Make the change and add or update relevant tests.
3. Run `npm run lint`, `npm run typecheck`, and the affected test suites.
4. Open a pull request with a concise description and verification notes.

For larger changes, opening an
[issue](https://github.com/Utzel-Butzel/inventory/issues) first helps align the
scope.

## License

Open Inventory is available under the [MIT License](LICENSE).
