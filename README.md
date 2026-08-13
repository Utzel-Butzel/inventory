# Inventory

Inventory is a self-hosted inventory workspace built with Next.js, Tailwind CSS,
PostgreSQL, and Drizzle ORM. It combines practical inventory CRUD with media
management, traceable stock control, camera-first batch capture, AI image
analysis, AI cover generation, duplicate merging, location views, and a scoped
bearer-token API.

Open Inventory is released under the [MIT License](LICENSE).

## Included

- Responsive dashboard, searchable grid/table inventory, and item editor
- Interactive street/satellite map with point and polygon editing, draggable
  geometry handles, layers, keyboard shortcuts, map selection, and multi-item
  quick edits
- Built-in tools, objects, furniture, vehicles, places, people, clothing, and
  project types, plus administrator-defined inventory types
- Quantities, status, SKU, serial number, value, categories, tags, location,
  notes, GPS, GeoJSON-compatible map features, priority, and ordered media
- Directed, configurable relationships between inventory items, including
  manual containment and automatic point-in-polygon placement on the map
- Typed custom fields for inventory items and serialized stock units, including
  searchable references to filtered inventory or stock records
- AI content translation with one canonical language, field-level freshness,
  whole-item context, terminology guidance, and automatic regeneration
- Bulk and serialized stock tracking with immutable dated movement history,
  per-inventory-location balances, and auditable location transfers
- Per-item inventory cycles, due-count queues, location-aware counts, and stock
  reconciliation
- Checkout, assignment, and reservation workflows for bulk stock and serialized
  units, with users, inventory items, or free-text recipients
- UTF-8 CSV import and export with row-level validation and idempotent retries
- Reusable browser-designed label setups with compact QR links, Code 128,
  optional object images, and presets for Brother 62 mm and 102 × 152 mm media
- Bills of materials for assembled items with atomic component consumption
- Purchase orders, incoming quantities, and partial goods receipts
- Minimum levels, reorder quantities, lead times, consumption rates, and
  predicted stockout dates
- Individually identified stock units with their own status, location,
  metadata, acquisition date, and complete audit trail
- Visual QR scan workflows with URL/EPD extraction, configurable properties,
  camera and photo decoding, reviewed execution, and idempotent audit records
- JPG, PNG, WebP, AVIF, HEIC, MP4, MOV, WebM, and PDF uploads
- EXIF location detection and client-side image optimization
- Camera-first batch capture with successive background jobs
- LiDAR RoomPlan room scans, reusable AR world maps, and measured indoor 3D
  placement for inventory captured with the native iPhone app
- Navigable Three.js room models with searchable, clickable inventory markers
  under **Rooms 3D**
- Photo-based recognition of existing inventory items with ranked, reviewable
  matches in the native camera
- Photo-based counting with a reviewable quantity before stock receipt or issue
- OpenAI image-to-record analysis with structured title, description, type,
  tags, alt text, and confidence output
- OpenAI or Google image editing for clean square studio covers
- Local persistent file storage or Openinary
- Database-backed custom roles, granular permissions, conditional item rules,
  and optional Auth0
- Hashed, scoped, expiring, revocable API tokens
- Durable outgoing integration webhooks with HMAC signatures, delivery history,
  bounded retries, secret rotation, and manual replay
- Duplicate scoring and transactional record merging
- Docker Compose deployment with PostgreSQL and persistent volumes

## Quick start with Docker

This is the recommended installation for one machine. After cloning the
repository, one installer command creates installation-specific secrets, starts
PostgreSQL and Inventory, applies every migration, waits for the health check,
and prints the initial sign-in details.

Requirements: Git, Docker with Compose v2, OpenSSL, and `curl`.

```bash
git clone https://github.com/Utzel-Butzel/inventory.git
cd inventory
./scripts/install.sh
```

Open the URL printed by the installer and sign in with its generated email and
password. The default is [http://localhost:3000](http://localhost:3000). To use a
different local port, run `APP_PORT=8080 ./scripts/install.sh`. A server behind a
TLS reverse proxy can instead use its exact public origin, for example
`AUTH_URL=https://inventory.example.com ./scripts/install.sh`; the local Compose
override still binds the application to loopback only.

The installer creates a mode-`0600` `.env`, starts the stack in the background,
and never replaces an existing `.env`. If that file already exists, review it
and start the configured stack with:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

Use [`.env.example`](.env.example) as the reference when adding optional
providers to the generated file; keep its installation-specific secret values
instead of copying the placeholders back over them.

PostgreSQL data and local uploads live in separate project-scoped named volumes
and survive container replacement. Do not run `docker compose down --volumes`
unless you intentionally want to delete both datasets.

### Secure first sign-in

The installer and hosting templates generate a unique
`BOOTSTRAP_ADMIN_PASSWORD` and set `BOOTSTRAP_ADMIN_PASSWORD_ONCE=true`. The
production entrypoint accepts this cleartext value only in that explicit mode,
converts it to a bcrypt hash before application code loads, and removes the
cleartext variable from the application process. The first matching successful
sign-in creates the database-backed administrator with only the bcrypt hash.

After that first sign-in, change the administrator password under **Settings →
Users**, remove `BOOTSTRAP_ADMIN_PASSWORD` and
`BOOTSTRAP_ADMIN_PASSWORD_ONCE` from `.env` or the hosting platform, and
redeploy. The database-backed account continues to work. Treat the generated
value as a real secret until it has been removed.

## One-click-ready hosting templates

The checked-in Dokploy and Coolify templates deploy the same production image
with PostgreSQL, health checks, automatic migrations, generated secrets, and
separate persistent database and upload volumes. They are prepared for the
platform catalogs, where selecting **Open Inventory** becomes the one-click
path. Until they are accepted there, the direct path is one template import or
copy/paste followed by **Deploy**—there is still no database wiring or secret
generation to do by hand. Optional AI, Auth0, external storage, and notification
providers can be added later. Both templates pull the multi-architecture
`ghcr.io/utzel-butzel/inventory:latest` image published by the checked-in
[`container-image.yml`](.github/workflows/container-image.yml) workflow.
After the package is created for the first time, a repository maintainer must
make it public once in GitHub's package settings so Dokploy and Coolify can pull
it without registry credentials.
[`deployment-check.yml`](.github/workflows/deployment-check.yml) builds a fresh
Compose installation in pull requests, waits for readiness, verifies the
generated first login, restarts the application, and verifies that login again.

### Dokploy

The [`deploy/dokploy`](deploy/dokploy) directory is a Dokploy template bundle:
[`template.toml`](deploy/dokploy/template.toml) defines the generated values and
domain, while [`docker-compose.yml`](deploy/dokploy/docker-compose.yml) defines
the complete stack.

1. In the target project and environment, create a **Docker Compose** service.
2. Open **Advanced → Import**, paste the complete contents of
   [`deploy/dokploy/base64.txt`](deploy/dokploy/base64.txt) into the Base64
   import, and confirm it.
3. Select the hostname Dokploy should secure with HTTPS and click **Deploy**.
4. In the Compose service's **Environment** view, reveal
   `BOOTSTRAP_ADMIN_PASSWORD` and use it with `admin@inventory.local` for the
   first sign-in.
5. Change the administrator password under **Settings → Users**, then edit the
   imported Compose definition to remove both
   `BOOTSTRAP_ADMIN_PASSWORD` and `BOOTSTRAP_ADMIN_PASSWORD_ONCE`, remove the
   generated password from the environment, and redeploy.

Dokploy generates `POSTGRES_PASSWORD`, `AUTH_SECRET`, and the initial admin
password. The template routes the selected HTTPS domain to container port 3000,
uses `/api/health`, and keeps both volumes attached across redeployments; no
separate database service or manual connection string is required.

### Coolify

[`deploy/coolify/compose.yaml`](deploy/coolify/compose.yaml) is a complete
Coolify service template using its generated password and FQDN variables.

1. In a Coolify project, choose **New Resource → Docker Compose Empty**, paste
   the contents of `deploy/coolify/compose.yaml`, and save it. This copy/paste is
   needed only until the template is available in the Coolify catalog.
2. Assign the generated or custom HTTPS domain to the `inventory` service on
   port 3000, then click **Deploy**.
3. Reveal `SERVICE_PASSWORD_64_ADMIN` in Coolify and sign in as
   `admin@inventory.local`.
4. Change the administrator password under **Settings → Users**, then edit the
   Compose resource to remove the
   `BOOTSTRAP_ADMIN_PASSWORD` and `BOOTSTRAP_ADMIN_PASSWORD_ONCE` mappings, then
   delete or rotate the generated admin secret and redeploy.

Coolify automatically supplies the application URL, database password,
`AUTH_SECRET`, and initial admin password referenced by the template. Database
and upload volumes remain isolated to the Coolify resource.

## Local development with npm and PostgreSQL

Requirements: Node.js 22.13 or newer, npm, and PostgreSQL 15 or newer. Create the
local role and database once using a PostgreSQL administrator. The password
below deliberately matches the development-only `DATABASE_URL` in
`.env.example`:

```bash
psql postgres -c "CREATE ROLE inventory LOGIN PASSWORD 'inventory';"
createdb --owner=inventory inventory
```

Skip either command when that role or database already exists, or put your
existing PostgreSQL credentials in `.env.local`. Then prepare the app:

```bash
npm ci
cp .env.example .env.local
npm run db:migrate
npm run db:seed
```

`npm run db:seed` is optional and adds sample inventory only when the workspace
is empty. For a development-only local login, set these values in the ignored
`.env.local` file before starting the server:

```dotenv
BOOTSTRAP_ADMIN_EMAIL=admin@inventory.local
BOOTSTRAP_ADMIN_NAME=Inventory admin
BOOTSTRAP_ADMIN_PASSWORD=choose-a-local-only-password
```

Start the development server, then open
[http://localhost:3000](http://localhost:3000):

```bash
npm run dev
```

Do not reuse the local database password, placeholder `AUTH_SECRET`, or
cleartext bootstrap password in a production deployment.

### SSH tunnel to a remote PostgreSQL database

Keep PostgreSQL private and forward it over SSH when remote database access is
needed for local development. Configure `.env.local` with an SSH host and either
a server-reachable PostgreSQL host or the name of its Docker container:

```dotenv
DB_TUNNEL_SSH_HOST=production.example.com
DB_TUNNEL_SSH_USER=deploy
DB_TUNNEL_DOCKER_SERVICE=inventree-postgres-i58yfc
DB_TUNNEL_LOCAL_PORT=15432
```

If PostgreSQL is already published on the production server's loopback
interface, replace `DB_TUNNEL_DOCKER_SERVICE` with
`DB_TUNNEL_REMOTE_HOST=127.0.0.1`. An SSH config alias can be used as
`DB_TUNNEL_SSH_HOST`; `DB_TUNNEL_IDENTITY_FILE` and `DB_TUNNEL_SSH_JUMP` are
available when needed. Start the foreground tunnel and keep that terminal open:

```bash
npm run db:tunnel
```

The command prints the loopback-only `DATABASE_URL` shape to use in a second
terminal. Never commit production credentials, and use a restricted database
role for routine local development.

Set `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` before building to use Mapbox streets and
satellite imagery. Without it, the map falls back to OpenFreeMap streets and
Esri World Imagery. `NEXT_PUBLIC_MAP_STYLE_URL` and
`NEXT_PUBLIC_SATELLITE_TILE_URL` can override those token-free services. Because
all three are build-time `NEXT_PUBLIC_*` values in Docker, changing them requires
a new image build.

## Verify and operate a deployment

### Verify

The readiness endpoint returns 200 only when PostgreSQL is reachable, every
bundled migration has been applied, and the configured storage is writable:

```bash
curl --fail http://localhost:3000/api/health
docker compose -f docker-compose.yml -f docker-compose.local.yml ps
```

Before relying on a new deployment, sign in, create a record, upload a file,
restart the stack, and confirm both are still present. Also test API-token and
stock-movement workflows when they are part of the intended use.

### Update

Back up first, review the incoming release, and then rebuild from the updated
checkout. Startup applies migrations under a PostgreSQL advisory lock before the
new application begins serving requests.

```bash
git pull --ff-only
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
curl --fail http://localhost:3000/api/health
```

On Dokploy or Coolify, update or redeploy the template/image and wait for the
same health check. Pin a released image tag instead of `latest` when the
deployment requires a controlled promotion process.

### Back up

Database rows and stored files are one logical dataset. Capture both in the same
quiet maintenance window and copy the resulting files off the Docker host:

```bash
mkdir -p backups
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T db \
  pg_dump -U inventory -d inventory -Fc > backups/inventory.dump
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T app \
  tar -czf - -C /app/data/uploads . > backups/inventory-uploads.tar.gz
```

Dokploy and Coolify users can use platform-native scheduled backups, but must
include both the PostgreSQL data and the upload volume. Regularly restore both
artifacts into a separate test deployment; an untested backup is not a recovery
plan.

### Troubleshooting

- **The installer stops immediately:** install Docker Compose v2, OpenSSL, and
  `curl`. If `.env` already exists, it is intentionally left unchanged.
- **The application does not become healthy:** run
  `docker compose -f docker-compose.yml -f docker-compose.local.yml logs --tail=200 db migrate app`.
  Check the database connection, migration output, and upload-volume permissions.
- **Production configuration is rejected:** use a non-placeholder
  `AUTH_SECRET` of at least 32 characters and the exact public HTTPS origin in
  `AUTH_URL`. URL-encode special characters inside a manual `DATABASE_URL`.
- **The first sign-in fails:** use the generated bootstrap email and password
  while the user table is still empty. Bootstrap values never reset an existing
  user; use **Settings → Users** from another administrator instead.
- **Uploads are not writable:** mount persistent storage at
  `/app/data/uploads`. A host bind mount must be writable by container UID/GID
  `1001`; named volumes from the supplied templates need no manual ownership
  setup.
- **Port 3000 is already in use:** remove an unintended conflicting service or
  run a fresh install with `APP_PORT=8080 ./scripts/install.sh`.

The production image also rejects plaintext `SIMPLE_AUTH_PASSWORD`, incomplete
Auth0 settings, and incomplete storage-provider settings. Local-file deployments
must keep PostgreSQL and `/app/data/uploads` together through backup, restore,
and migration work.

## Authentication

### Local accounts

The installer and hosting templates use the recommended one-time bootstrap mode
described under [Secure first sign-in](#secure-first-sign-in). For a manual
production deployment on an empty database, configure a unique initial password
of at least 12 characters:

```dotenv
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_NAME=Inventory admin
BOOTSTRAP_ADMIN_PASSWORD=a-unique-generated-initial-password
BOOTSTRAP_ADMIN_PASSWORD_ONCE=true
```

Alternatively, install dependencies and generate a bcrypt hash before deploying:

```bash
npm ci
npm run auth:hash -- "your new password"
```

Then configure the hash instead of either password variable:

```dotenv
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_NAME=Inventory admin
BOOTSTRAP_ADMIN_PASSWORD_HASH='$2b$12$...'
```

Keep a bcrypt hash in single quotes when it is stored in a Compose `.env` file
so its `$` characters remain literal. Do not add those quotes when a hosting
platform stores the value directly. The legacy `SIMPLE_AUTH_*` variables remain
only as a compatibility fallback while the user table is empty; production
rejects `SIMPLE_AUTH_PASSWORD`.

The first matching successful login creates the database-backed administrator,
but only while the user table is empty. Bootstrap variables cannot overwrite or
reset an existing account.

That administrator can then create, disable, re-enable, reset, and assign roles
to additional accounts under **Settings → Users**. Roles are configured under
**Settings → Roles & access**. All accounts share the same inventory workspace:

- `admin` manages users, API tokens, and integration webhooks and has full
  inventory and AI access.
- `editor` can read and change inventory and use AI features.
- `viewer` has read-only access.

These built-in roles preserve the original defaults. You can also create custom
roles and select individual inventory, stock, assignment, count, spatial,
purchasing, workflow, label, AI, settings, user, sharing, token, and webhook
permissions.

Conditional inventory rules provide additive access to matching items. For
example, a role without global item-update access can be allowed to update only
items whose `tags` contain `xyz`. Rules support item ID, name, type, status, SKU,
location, serial number, priority, tags, categories, creator, and
`customFields.<key>` conditions. Every condition in a rule must match.

After the first administrator exists, change its password under **Settings →
Users**, remove all bootstrap password values from the deployment environment,
and restart or redeploy. Existing database users continue to work. Disabling a
user or resetting a password invalidates that user’s existing sessions.

Native clients use the same local email and password at
`POST /api/v1/auth/login`. Tokens expire after 30 days by default; configure
`NATIVE_TOKEN_TTL_DAYS` from 1 to 365 if needed. Logout revokes the current
token. Password, role, and account-status changes invalidate all native tokens
for that user.

### Auth0

Set all three values to enable the Auth0 button:

```dotenv
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...
AUTH0_DOMAIN=your-tenant.eu.auth0.com
AUTH0_DEFAULT_ROLE=editor
# Optional custom claim containing a built-in or custom role key:
AUTH0_ROLE_CLAIM=https://inventory.example.com/role
```

Use this callback URL in Auth0:

```text
https://your-inventory.example/api/auth/callback/auth0
```

For local development, use
`http://localhost:3000/api/auth/callback/auth0`.

Auth0 identities are managed in Auth0 rather than the local user list. Restrict
the enabled Auth0 connections or invitations at the tenant level; every
successful Auth0 login receives `AUTH0_DEFAULT_ROLE`, unless the configured role
claim contains an existing role key. Unknown role keys fail closed.

## Notifications

Every signed-in user has an in-app notification inbox for low stock, expiry,
maintenance, and due returns. The defaults deliberately favor signal over
volume: external delivery is disabled, eligible events are deduplicated with a
24-hour cooldown, and enabled external channels use one daily digest at 08:00 in
the recipient's configured timezone. Users can change thresholds, due-date
windows, locale, cadence, and explicit channel opt-ins under **Settings →
Notifications**. External digests show at most 20 details plus a remaining-item
count; the complete event history stays in the in-app inbox.

All destinations and credentials remain deployment environment variables. Slack,
Teams, and generic webhook URLs are shared deployment targets and are redacted
in the UI; identical team-channel digests are dispatched only once even when
multiple users enable the same channel. Web Push subscriptions are encrypted at
rest with `NOTIFICATION_ENCRYPTION_KEY`. Generate an independent 32-byte key and
a VAPID pair, for example:

```bash
openssl rand -base64 32
npx web-push generate-vapid-keys
```

Configure only the channels the deployment should offer:

```dotenv
NOTIFICATION_WORKER_ENABLED=true
NOTIFICATION_WORKER_POLL_MS=900000
NOTIFICATION_ENCRYPTION_KEY=...

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=inventory
SMTP_PASSWORD=...
NOTIFICATION_EMAIL_FROM=Inventory <inventory@example.com>

WEB_PUSH_PUBLIC_KEY=...
WEB_PUSH_PRIVATE_KEY=...
WEB_PUSH_SUBJECT=mailto:admin@example.com

NOTIFICATION_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
NOTIFICATION_TEAMS_WEBHOOK_URL=https://...
NOTIFICATION_WEBHOOK_URL=https://automation.example.com/inventory
NOTIFICATION_WEBHOOK_SIGNING_SECRET=...
```

The Node process runs the detector and digest dispatcher by default. On a
serverless or externally scheduled deployment, disable that loop and invoke the
same idempotent cycle from a scheduler:

```dotenv
NOTIFICATION_WORKER_ENABLED=false
NOTIFICATION_CRON_SECRET=replace-with-a-long-random-secret
```

```bash
curl -X POST "https://inventory.example.com/api/v1/notifications/run" \
  -H "Authorization: Bearer $NOTIFICATION_CRON_SECRET"
```

The channel test actions and `POST /api/v1/notifications/test` are preview-only:
they never open SMTP, Push, Slack, Teams, or webhook connections. This makes
configuration review and automated tests safe from accidental external sends.

## Outgoing integration webhooks

Outgoing webhooks provide durable event-driven integration alongside the REST
API. They are separate from the optional generic notification-digest webhook
above: each endpoint selects inventory event types, receives one durable delivery
record per event (with one or more signed HTTP attempts), and has its own delivery
history and signing secret.
Configuration is available under **Settings → Webhooks** and through
`/api/v1/webhooks`. Every management route requires an authenticated browser
session with `webhooks.manage`; API bearer tokens cannot administer endpoints.
This is a workspace-wide export permission: a holder can send complete resource
and stock event snapshots to an external destination even without separate
per-resource read grants. Assign it only to trusted administrators/integrators.
The scheduler-only `POST /api/v1/webhooks/run` route instead accepts
`WEBHOOK_CRON_SECRET` as its bearer credential.

Supported subscriptions are:

- `inventory.resource.created`: the new resource snapshot
- `inventory.resource.updated`: the current resource plus `changedFields`
- `inventory.resource.deleted`: the final resource snapshot
- `inventory.resource.merged`: kept and removed snapshots and their IDs
- `inventory.stock.movement.created`: the immutable stock movement snapshot

The request body is an envelope with `id`, `type`, `apiVersion: "1"`,
`occurredAt`, nullable `actor`, and event-specific `data`. Delivery is at least
once. Store processed event IDs and return a 2xx response only after committing
the corresponding work, because a timeout or lost acknowledgement can deliver
the same event again.

Every request includes this header:

```text
X-Inventory-Signature: t=<unix>,v1=<hex>
```

`v1` is the lowercase hexadecimal HMAC-SHA256 of
`<unix>.<exact raw request body>` using the endpoint's secret. Verify the raw
bytes before parsing or reserializing the JSON, compare the digest in constant
time, and reject timestamps outside the receiver's chosen replay window. The
same event, type, delivery, and timestamp values are also sent as
`X-Inventory-Event-Id`, `X-Inventory-Event-Type`,
`X-Inventory-Delivery-Id`, and `X-Inventory-Timestamp`. The secret is shown only
when an endpoint is created or rotated and is encrypted at rest with
`WEBHOOK_ENCRYPTION_KEY`; it cannot be retrieved later.
Each queued delivery keeps the encrypted secret version active when it was
created, so rotating a secret does not break retries already in flight.
Keep that encryption key stable and backed up. Changing or losing it makes
existing targets and signing secrets unreadable; rotate endpoints only after a
controlled re-encryption migration.

Configure the delivery worker independently from quiet notifications:
Generate an independent value with `openssl rand -base64 32`, assign it to
`WEBHOOK_ENCRYPTION_KEY`, and keep it stable across redeployments.

```dotenv
WEBHOOK_ENCRYPTION_KEY=...
WEBHOOK_WORKER_ENABLED=true
WEBHOOK_WORKER_POLL_MS=2000
WEBHOOK_WORKER_CONCURRENCY=4
WEBHOOK_DELIVERY_TIMEOUT_MS=10000
WEBHOOK_MAX_ATTEMPTS=8
WEBHOOK_RETENTION_DAYS=30
WEBHOOK_ALLOW_PRIVATE_NETWORKS=false
```

The runtime bounds poll intervals to 500–60,000 ms, concurrency to 1–20,
delivery timeouts to 1,000–60,000 ms, maximum attempts to 1–20, and retention
to 1–365 days. Terminal delivery history and its plaintext event snapshots are
removed after the configured retention period; pending work is never removed.

Targets must use HTTPS and cannot contain credentials or URL fragments. Local
and private-network destinations are blocked by default to reduce SSRF risk;
set `WEBHOOK_ALLOW_PRIVATE_NETWORKS=true` only when the application is expected
to call trusted internal services. Stored targets are redacted in API and UI
responses.

Network failures, timeouts, HTTP 408, 425, 429, and 5xx responses are retried
with delays of 1 minute, 5 minutes, 30 minutes, 2 hours, 12 hours, and then 24
hours, bounded by `WEBHOOK_MAX_ATTEMPTS`. Other non-2xx responses fail without
an automatic retry. Failed deliveries remain visible and can be replayed
manually. The endpoint test action is a real signed, queued HTTP delivery—not
the preview-only test used by notification channels. It uses the dedicated
`inventory.webhook.test` event type, which cannot be selected as a normal
subscription and therefore cannot be mistaken for a resource update.

The Node process runs the webhook worker by default. For serverless or externally
scheduled deployments, disable it and invoke one bounded due-delivery cycle:

```dotenv
WEBHOOK_WORKER_ENABLED=false
WEBHOOK_CRON_SECRET=replace-with-a-long-random-secret
```

```bash
curl -X POST "https://inventory.example.com/api/v1/webhooks/run" \
  -H "Authorization: Bearer $WEBHOOK_CRON_SECRET"
```

## Stock management

Every inventory record has a stock ledger. Choose the tracking model that fits
the item:

- **Bulk** for interchangeable parts and consumables. Book any positive or
  negative quantity, such as receiving 100 printed battery trays or consuming
  50. Every booking stores its effective date, creation date, resulting
  balance, reason, note, location, and actor.
- **Serialized** when every physical unit needs its own identity. Units receive
  a generated UUID and readable stock code and can also carry a custom code,
  location, lifecycle status, acquisition date, and arbitrary JSON metadata.
  Status, location, and metadata changes are written to the audit ledger.

Set a minimum stock level, normal reorder quantity, lead time, and unit label
per record. The **Stock** screen highlights low and empty items, calculates
average daily usage from dated outgoing movements, estimates the stockout date,
and recommends replenishment before the lead-time window is exhausted.

Balances cannot go below zero. Historical entries are append-only; corrections
are made with a new dated adjustment so the original event remains traceable.

### Inventory structure, locations, and counts

Administrators can define inventory types such as room, cabinet, machine, or
device under **Settings → Inventory types**. Types have stable API keys and can
be configured to contain other inventory. Directed relationship types describe
how records belong together. Containment can be assigned manually, while map
points and polygons automatically create spatial containment when an item lies
inside a container polygon. Manual placement takes precedence and containment
cycles are rejected.

Any inventory record whose type can contain items can also serve as a structured
stock location. Bulk movements may receive into, issue from, or transfer stock
between those locations without losing the global audit trail. Serialized units
carry their location directly. The stock UI keeps the global quantity and the
per-location breakdown visible without requiring every item to use locations.

Each item can opt into a recurring inventory cycle from 1 to 3,650 days. The due
queue highlights counts that need attention; recording a bulk count reconciles
the total or one selected location and appends both a count record and a stock
movement. Serialized inventory is reviewed through its individual units; after
any unit statuses are corrected, the matching review completes the same cycle
without replacing unit-level traceability with a bulk adjustment.

### Indoor 3D rooms and structures

On a LiDAR-capable iPhone, open **Rooms**, create or continue a named structure,
and scan its rooms floor by floor. RoomPlan records walls, openings, floors,
and recognized furniture; rooms captured in one uninterrupted capture batch
share a `coordinateSpaceId`. Inventory stores each room as a
versioned normalized scene together with its original USDZ model, an optional
combined structure USDZ and guide image, and an archived `ARWorldMap` used only
by the native app. During the same ARKit session the app also samples up to 32
bounded RGB JPEG keyframes. Every keyframe stores the `worldFromCamera`
transform, pinhole intrinsics, encoded native-raster pixel dimensions, display orientation, capture
time, and quality in the scan's `coordinateSpaceId`. The authenticated scene
API exposes this calibrated set for camera-frustum previews and later visual
feature matching without introducing a second coordinate system.

**Add room/floor** keeps the building identity but starts a deliberately new
coordinate space, while **Rescan room** replaces only that room's active
revision. This prevents independently initialized AR sessions from being
overlaid as though they shared an origin.

When capturing a new item, choose **Im Raum**, select the recorded room, and
point the reticle at the object. The app first relocalizes against the saved
world map; only then does it combine LiDAR scene depth (or a plane raycast) with
the camera pose to save the item's position in metres. The same AR frame becomes
an ordinary inventory photo, so the existing image analysis can learn the
record's name and appearance. Open **Rooms 3D** in the web app to select a
building and floor, orbit its connected parametric rooms, search positioned
items, and click a marker to open the inventory record.

A structure can carry a canonical latitude/longitude marker, while every AR
coordinate space can carry its own geographic anchor, altitude, and true-north
heading. The map uses these anchors to drill down from a building marker to
floors, room footprints, and positioned inventory. GPS and compass establish
the global building location; when map anchoring is enabled, capture waits for
a fresh paired reading before the scan begins. The saved AR world map remains responsible for
precise indoor relocalization. An entry marker code can be stored for a future
or external re-entry workflow, but the current client does not use it to
relocalize. Independently captured or unrelocalized frames are never overlaid:
local room bounds are combined only when all involved scans have the same
explicit `coordinateSpaceId`.

The scan list returns only a bounded `keyframeCount`; calibrated camera metadata
is fetched with the selected room scene, and stored feature descriptors are not
echoed into normal read responses.

An item photo can optionally record `localizationEvidence` referencing a
keyframe from that exact room scan. The backend checks this relationship before
saving the placement, so a Vision feature-print match can corroborate ARWorldMap
relocalization without allowing evidence from another coordinate frame.

Photorealistic derivatives are optional. `textured_mesh` accepts a
self-contained GLB v2, while `gaussian_splat` accepts a bounded binary
little-endian, vertex-only PLY. Their vertex coordinates must already be in the
scan's shared ARKit world frame (metres, right-handed, Y-up); the server does
not guess or align a reconstruction transform. Both can be included in the original multipart
scan or attached/replaced later with `PUT
/api/v1/room-scans/{scanId}/assets/{kind}` for an external reconstruction
pipeline. Upload validation rejects external GLB resources, variable-length or
extra PLY elements, malformed headers, files above 80 MB, unsafe GLB accessor
ranges/allocation counts, oversized embedded textures, and required codecs the
bundled viewer does not support. The web viewer
uses textured GLB directly. Its PLY path is deliberately a bounded point-splat
preview (at most 250,000 sampled points), not a covariance-sorted full Gaussian
Splat renderer; RoomPlan remains the authoritative geometry and placement
frame. Linked-room derivative loading is sequential and capped by a shared
120 MiB/two-asset browser budget, with RoomPlan retained for skipped rooms.

RoomPlan is a measured parametric model rather than a photorealistic scan, and
small tools are represented by location markers rather than automatically
generated 3D meshes. A new room revision intentionally supersedes the previous
room scan. A new rescan receives a new `coordinateSpaceId` instead of being
assumed compatible with an older AR origin; old placements stay attached to the
old revision until each item is captured again. `MAX_ROOM_SCAN_UPLOAD_MB` limits
the combined world map, room/structure USDZ, guide image, RGB keyframes, and
photorealistic derivatives for one upload and defaults to 100 MB. Each keyframe
is additionally limited to 6 MiB and 4096×4096 encoded pixels. Room-scan and
derivative uploads require `Content-Length` before their bodies are buffered;
deployments should retain an equivalent request-body limit at the ingress.

### Assignments and reservations

Bulk quantities and serialized units can be checked out, assigned, or reserved
for a workspace user, another inventory item, or a free-text recipient. Active
allocations reduce available stock and are represented in the immutable stock
ledger. Returning or cancelling an allocation restores its quantity and, for a
serialized unit, its available status. Mutation requests are idempotent so a
network retry cannot allocate or return the same stock twice.

### Custom fields

Administrators configure custom fields under **Settings → Custom fields** for
inventory items or individually tracked stock units. A definition has a stable
API key, display label, description, placeholder, position, and optional
required flag. Supported field types are single-line text, long text, number,
yes/no, date, date and time, select, multi-select, dynamic reference, email
address, and URL.
Number fields can define minimum, maximum, and step values; select fields carry
their own stored values, display labels, and optional colours.

Reference fields target either inventory items or serialized stock units. They
can allow one or many choices and filter the searchable list by target inventory
type, category, and status. Values are stable UUIDs, not copied display names;
the API verifies every newly assigned target and the UI resolves stored IDs back
to current names. For example, create ordinary inventory records in a
`Manufacturer` category, then configure a single-value reference field whose
target category is `Manufacturer`. The same field type is available on stock
units, and stock-unit targets can be selected as well.

Definitions can target inventory types, categories, or both. An empty target
list is a wildcard. When both lists are populated, an item must match one type
and at least one category. Stock-unit fields use the type and categories of the
unit's parent inventory item, so one configuration can describe every physical
unit in the same class of inventory.

Values are stored in the `customFields` object on inventory records and stock
units, separately from the stock unit's legacy integration `metadata`. The API
validates values against the active definitions that apply to the item. Editing
a definition increments its revision; update requests include the last observed
revision so concurrent edits cannot silently overwrite each other. Deleting one
archives the definition instead of erasing it or its previously stored values;
archived definitions are hidden from normal forms and can still be requested
through the API.

### Content languages and AI translation

Administrators configure the canonical authoring language and target languages
under **Settings → Content languages**. Inventory names, descriptions, notes,
applicable text or textarea custom fields, and media alt text are translated.
Tags, categories, types, SKUs, URLs, and other identifiers remain canonical so
filters and integrations do not split into locale-specific values.

Each resource and locale has one atomic translation document, with a source
hash for every field. A database trigger commits a coalesced translation job in
the same transaction as every canonical content write—including imports,
analysis, media changes, and merges. A leased background worker processes one
locale at a time, sends only missing or stale fields, and supplies the complete
safe item context for consistent terminology. Jobs survive restarts, retry with
backoff, and are safe across multiple application replicas.

Provider results use strict structured output and are written only when the job
generation, language policy, and source hashes still match. Missing or stale
fields fall back individually to the canonical value. Manual translations are
locked against AI overwrite; after their source changes, AI creates a suggestion
that remains in review until a person accepts it or edits the translation.

Each target language can enable automatic refresh and provide terminology or
tone guidance. Adding an automatic language queues an existing-inventory
backfill, and changing guidance invalidates AI-managed translations. The item
editor exposes queued, processing, failed, stale, and review states. The default
language is locked once translations exist because changing it would relabel
canonical content without rebuilding every saved translation.

### Assemblies and bills of materials

Any inventory item can define a bill of materials. The item record describes the
finished product; saving that record does not consume components. Use the
explicit **Build assembly** action to create finished stock. One build validates
every component, books all component issues and finished outputs in one database
transaction, and links the resulting ledger entries to a shared build record.

Bulk components are deducted by quantity. Serialized components are moved from
available stock to `in-use` and linked to the concrete build and, when the output
is serialized, to the finished unit in which they were installed. If any
component is unavailable, the complete build is rolled back. Existing finished
stock is never consumed retroactively when a bill of materials is added or
changed. Build requests are idempotent, so retrying after a timeout cannot
consume the same components twice.

### Purchase orders and incoming stock

Ordered quantities are tracked separately from physical stock. Open and partial
purchase orders contribute to the **incoming** and projected quantities, but do
not increase available stock. A full or partial goods receipt creates the dated
positive stock movement (or serialized units), reduces the open quantity, and
updates the order status atomically. Reorder suggestions take already ordered
quantities into account while low-stock warnings continue to reflect what is
actually available. Purchase-order creation and goods receipts are idempotent;
the web interface keeps the same operation key when an unchanged request is
retried, preventing duplicate orders or receipts after a network interruption.

### Configurable QR scan workflows

The **Stock → Workflows** screen turns QR scans into reviewed stock-unit
updates without custom code. A workflow defines how an identifier is extracted
from the scanned value, which serialized inventory item it belongs to, which
properties the operator must choose, and which fixed properties or lifecycle
status should be applied. Workflows can use the complete code, remove a known
prefix, or read a named query parameter from an optionally restricted URL.

The included assembly template reads the `d` parameter from Paperless Paper QR
links, stores it as the unit's EPD number, marks the assembly process as
finished, and asks for one of the configured colour values. Assembly state is a
unit property rather than a lifecycle status, so marking an item as assembled
does not remove it from available stock.

Operators use **Stock → Scan** to scan with the rear camera, upload an existing
QR photo, or paste a code. Inventory resolves and previews the target before the
operator confirms the change. Scan execution is transactional and idempotent:
the unit update, available quantity, ledger entry, and scan audit record either
all succeed together or all roll back, and retrying the same request does not
create a second movement. The confirmation is bound to the workflow revision
and the resource/unit versions shown in the preview; a concurrent change
forces the operator to resolve and review the scan again.

## Inventory exchange and label printing

The inventory screen exports the complete workspace as import-compatible UTF-8
CSV, a formatted Excel workbook, or a compact paginated PDF report. The Excel
workbook keeps identifiers as text, dates and numbers typed, enables filters,
freezes navigation headers, and includes variants on a separate sheet. The CSV
remains the default API response for backwards compatibility and includes
the parent barcode plus variants as export-only JSON. CSV import round-trips the
parent barcode, accepts the variants column, but does not create variants from
it; variants continue to be managed through their dedicated API.
CSV import accepts up to 1,000 rows or 5 MB per request,
validates each row independently, never overwrites an existing SKU, reports
row-level failures, and requires an idempotency key so retrying the same file
does not duplicate records. Tags, categories, custom fields,
related-resource IDs, map features, and variants use JSON inside their CSV
cells.

The **Labels** screen applies reusable setups that store the physical media size
and the visibility, position, and size of each label element. Editors can use
the visual designer to create, copy, edit, and delete setups; available elements
are QR code, object cover image, name, SKU or resource identifier, Code 128
barcode, printed URL, and location. Text alignment and size and image
crop/contain behavior are configurable. Preset setups are included for Brother
62 × 35 mm and 62 × 50 mm continuous-roll labels and 102 × 152 mm
large-format media.

QR codes and printed URLs use a compact `/r/{code}` link whose 22-character
base64url code losslessly represents the resource UUID. The redirect preserves
the normal access boundary: signed-in users go to the item, while other users
are sent through login with the item as the callback. Printing waits for object
cover images to load, then uses the browser's system print dialog, so a Wi-Fi
Brother printer must first be available to the operating system with the setup's
media size selected and page scaling disabled.

## File storage

### Local persistent storage

```dotenv
STORAGE_PROVIDER=local
STORAGE_LOCAL_PATH=./data/uploads
MAX_UPLOAD_MB=25
MAX_USDZ_UPLOAD_MB=100
MAX_ROOM_SCAN_UPLOAD_MB=100
```

Files are kept outside the application bundle and streamed through an
authenticated same-origin route. In Docker, `/app/data/uploads` is backed by the
`inventory_uploads` volume. Apple Object Capture models are stored as `.usdz`
files with the registered `model/vnd.usdz+zip` media type and use the separate
`MAX_USDZ_UPLOAD_MB` limit, which defaults to 100 MB for realistic captures.

### Openinary

```dotenv
STORAGE_PROVIDER=openinary
OPENINARY_BASE_URL=https://media.example.com
OPENINARY_API_KEY=...
```

Uploads use Openinary’s `/api/upload` endpoint with bearer authentication and
request common cached image sizes. Openinary currently accepts image and video
formats only, so USDZ inventory models require `STORAGE_PROVIDER=local` with a
persistent upload volume; the API rejects that provider mismatch before writing
any part of the upload batch.

## AI features

Image analysis uses OpenAI’s Responses API, while photo counting uses selectable
Replicate models:

```dotenv
OPENAI_API_KEY=...
OPENAI_VISION_MODEL=gpt-4.1-mini
OPENAI_TRANSLATION_MODEL=gpt-5.6-terra
OPENAI_TRANSLATION_TIMEOUT_MS=120000
TRANSLATION_WORKER_ENABLED=true
TRANSLATION_WORKER_POLL_MS=2000
TRANSLATION_WORKER_CONCURRENCY=1
TRANSLATION_JOB_LEASE_SECONDS=180
TRANSLATION_JOB_MAX_ATTEMPTS=5
REPLICATE_API_TOKEN=...
REPLICATE_COUNT_DEFAULT_MODEL=grounding-dino
REPLICATE_GROUNDING_DINO_MODEL=adirik/grounding-dino:efd10a8ddc57ea28773327e881ce95e20cc1d734c589f7dd01d2036921ed78aa
REPLICATE_YOLO_WORLD_MODEL=ultralytics/yolov8s-worldv2:5e89b91b497fa7329dc88dbf820923190236ef7bc5a9b4aa1b7192b206656650
REPLICATE_SAM2_MODEL=meta/sam-2:fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83
REPLICATE_COUNT_MODEL=yodagg/sam3-image-seg:29c8e52db92a11c64f8939244d6b3a047ce2af24412b7971309008b9a61e2f6e
REPLICATE_COUNT_DEADLINE_SECONDS=300
REPLICATE_COUNT_JOB_SECRET=... # optional; falls back to AUTH_SECRET
REPLICATE_COUNT_CONFIDENCE=0.5
REPLICATE_COUNT_MAX_MASKS=100
AI_OUTPUT_LANGUAGE=English
AI_ANALYSIS_RATE_LIMIT_PER_MINUTE=10
AI_COUNT_RATE_LIMIT_PER_MINUTE=10
AI_TRANSLATION_RATE_LIMIT_PER_MINUTE=30
```

An OpenAI-compatible endpoint can be selected with `OPENAI_BASE_URL`.
Content translation uses the Responses API with strict structured output. The
model default is `gpt-5.6-terra`; override `OPENAI_TRANSLATION_MODEL` when the
compatible endpoint exposes another model.

The bulk-stock screen and native item detail can send one transient camera image
to the selected counting model, localize the requested parts, and copy the
result into a stock receipt or issue. Grounding DINO is the fast default. YOLO
World is a second open-vocabulary detector, SAM 3 provides detailed
text-directed segmentation, and SAM 2 is available as an experimental automatic
mask counter that can also count background regions. The API token remains server-side;
Replicate automatically removes API prediction inputs and outputs after its
retention window, and the source is not stored as inventory media. A provider
deadline and matching client timeouts prevent a cold model from leaving the UI
waiting indefinitely. The initial request returns a signed job token; Web and
iOS then poll that exact prediction, retry transient poll errors, and never start
a second prediction merely because the model is still warming. An idempotency
key also makes a lost start response safe to retry. Counting can be uncertain
when parts overlap, are cropped,
hidden, unusually small, or too specialized for the text description, so the
detected quantity and confidence are always shown for review and can be corrected
before the stock movement is submitted.

The current pinned SAM 3 wrapper accepts the count photo plus a text prompt; it
does not accept a separate reference photo. It can return at most 100 masks. If
that ceiling is reached, the API rejects the truncated result and asks the user
to split the parts into smaller groups instead of filling an incorrect quantity.
The server resizes count photos to a bounded JPEG and sends them inline, so no
public image URL or separate Replicate file upload is required.

Cover generation can use OpenAI:

```dotenv
IMAGE_EDIT_PROVIDER=openai
OPENAI_IMAGE_EDIT_MODEL=gpt-image-1
AI_IMAGE_RATE_LIMIT_PER_HOUR=12
```

Or Google:

```dotenv
IMAGE_EDIT_PROVIDER=google
GOOGLE_AI_API_KEY=...
GOOGLE_IMAGE_EDIT_MODEL=gemini-2.5-flash-image
```

To let the Webapp and iOS app choose among several approved models, configure
a comma-separated allowlist and an optional default. Each entry uses
`provider:model`; models whose provider credentials are missing are not offered
to clients.

```dotenv
IMAGE_EDIT_MODELS=openai:gpt-image-1,openai:gpt-image-1-mini,openai:gpt-image-1.5,openai:gpt-image-2,google:gemini-2.5-flash-image,google:gemini-3.1-flash-lite-image,google:gemini-3.1-flash-image,google:gemini-3-pro-image
IMAGE_EDIT_DEFAULT_MODEL=google:gemini-3.1-flash-image
```

The model choice is remembered locally in each client and included in every
cover request. The server validates it against this allowlist. Leave both new
variables empty to keep the existing single-provider, single-model behavior.

The inventory editor can store generated covers as transparent PNGs. The
`greenscreen` method uses one chroma-keyed generation and is faster, while
`difference-matting` (the default transparent method) generates aligned white
and black passes before recovering the alpha channel. Difference matting costs
two provider image generations but preserves fine edges, glass, and soft
shadows more reliably. API clients opt in with `transparentBackground: true`
and may set `transparencyMethod` to either method.

Every provider-backed AI route is authenticated, scope-checked, upload-limited,
and protected by an atomic PostgreSQL rate limit per identity. The limits work
across app replicas and restarts. `AI_ANALYSIS_RATE_LIMIT_PER_MINUTE` and
`AI_COUNT_RATE_LIMIT_PER_MINUTE` control analysis and photo counting
independently; if either is unset, it falls back to the backwards-compatible
`AI_RATE_LIMIT_PER_MINUTE` value (default `10`). Cover generation uses
`AI_IMAGE_RATE_LIMIT_PER_HOUR` (default `12`). Set an operation's value to `0`
to disable it. Invalid explicitly configured values fail closed and disable the
affected operation until the configuration is corrected.

## API tokens

Create tokens under **Settings → API access**. The plaintext token is shown
once; only its SHA-256 digest is stored. Available scopes are:

- `read`: list and retrieve records, files, statistics, and duplicate matches
- `write`: create, edit, delete, upload, reorder, and merge
- `ai`: run image analysis, photo counting, and cover generation

Use a token as a bearer credential:

```bash
curl "http://localhost:3000/api/v1/resources?pageSize=25" \
  -H "Authorization: Bearer inv_your_token"
```

Create a record:

```bash
curl -X POST "http://localhost:3000/api/v1/resources" \
  -H "Authorization: Bearer inv_your_token" \
  -H "Content-Type: application/json" \
  --data '{"name":"Cordless drill","type":"tool","status":"available","quantity":1,"tags":["workshop"]}'
```

Configure its stock policy and book a receipt:

```bash
curl -X PATCH "http://localhost:3000/api/v1/resources/RESOURCE_ID/stock/config" \
  -H "Authorization: Bearer inv_your_token" \
  -H "Content-Type: application/json" \
  --data '{"trackingMode":"bulk","minimumStock":25,"reorderQuantity":100,"leadTimeDays":7,"unitName":"trays"}'

curl -X POST "http://localhost:3000/api/v1/resources/RESOURCE_ID/stock/movements" \
  -H "Authorization: Bearer inv_your_token" \
  -H "Content-Type: application/json" \
  --data '{"delta":100,"type":"receipt","reason":"Production batch 2026-08","location":"Workshop shelf B2"}'
```

Create individually tracked units instead:

```bash
curl -X POST "http://localhost:3000/api/v1/resources/RESOURCE_ID/stock/units" \
  -H "Authorization: Bearer inv_your_token" \
  -H "Content-Type: application/json" \
  --data '{"count":3,"location":"Assembly room","metadata":{"material":"PETG","revision":"C"}}'
```

Read the active custom-field definitions with a token that has the `read`
scope:

```bash
curl "http://localhost:3000/api/v1/custom-fields?entityType=inventory" \
  -H "Authorization: Bearer inv_your_token"
```

Definition writes (`POST /api/v1/custom-fields` and `PATCH` or `DELETE` on
`/api/v1/custom-fields/{id}`) require an authenticated administrator browser
session and do not accept API tokens. Inventory and stock-unit create/update
requests carry configured values in `customFields`, keyed by each definition's
stable key. For example: `{"customFields":{"colour":"yellow","voltage":18}}`.
Reference values use one UUID or an array of UUIDs. Search or resolve choices
through `GET /api/v1/custom-fields/{id}/options?q=acme`; selected IDs may be
repeated as `selected` query parameters so saved values remain readable even
after a target stops matching the field's current filters.

Upload media after creation:

```bash
curl -X POST "http://localhost:3000/api/v1/resources/RESOURCE_ID/media" \
  -H "Authorization: Bearer inv_your_token" \
  -F "files=@drill.jpg"
```

Apple Object Capture output uses the same endpoint with its canonical media
type (and requires local storage):

```bash
curl -X POST "http://localhost:3000/api/v1/resources/RESOURCE_ID/media" \
  -H "Authorization: Bearer inv_your_token" \
  -F "files=@drill.usdz;type=model/vnd.usdz+zip"
```

## Native iOS scanner

The repository also includes **Inventory**, a native SwiftUI app under
[`ios/Inventory`](ios/Inventory). It photographs inventory items,
scans QR and common retail/industrial barcodes, resolves existing records, and
runs the same create → upload → AI analysis → cover workflow as the browser's
batch capture screen.

The app signs in with a local workspace account and stores the resulting bearer
token in the iOS Keychain. Photos are resized to 2,200-pixel JPEGs
and copied to a persistent, origin-bound outbox before upload. Resource, media,
analysis, and cover operations use server-side idempotency keys so network
retries do not duplicate data or AI work. See the iOS README for Xcode, device,
signing, and server setup.

Scanned resource UUIDs, `inventory:` links, web inventory links, exact SKUs,
and exact serial numbers resolve through:

```text
GET /api/v1/resources/lookup?code=...
```

Then enrich the record:

```bash
curl -X POST "http://localhost:3000/api/v1/resources/RESOURCE_ID/analyze" \
  -H "Authorization: Bearer inv_your_token" \
  -H "Content-Type: application/json" \
  --data '{"overwrite":true}'
```

The checked-in [OpenAPI YAML specification](./public/openapi.yaml) documents
the complete bearer-token surface. A running deployment also serves the same
contract as JSON at `/openapi.json`. Anyone can browse the interactive API
reference at `/api-docs`; authenticated requests still require a browser
session or scoped API token.

## Commands

```text
./scripts/install.sh  Install the local Docker stack and generate secure defaults
npm run dev          Start the development server
npm run build        Create a production build
npm run start        Start the production server
npm run lint         Run ESLint
npm run typecheck    Run TypeScript checks
npm run test:deployment Test one-time production bootstrap handling
npm run test:locations   Test geographic containment and EXIF coordinates
npm run test:translations Test language normalization and field freshness
npm run test:room-scenes Test RoomPlan scene and placement contracts
npm run db:tunnel    Forward a remote PostgreSQL database over SSH
npm run db:migrate   Apply checked-in PostgreSQL migrations
npm run db:seed      Add sample records when the database is empty
npm run db:generate  Generate a Drizzle migration after schema changes
npm run auth:hash    Generate a bcrypt password hash
```

## Architecture notes

- Session and bearer-token authorization are both enforced inside every data
  route; the dashboard layout redirect is not the security boundary.
- Bearer-token scopes are transport ceilings. Role permissions and conditional
  item rules remain the authorization boundary for user-linked tokens.
- Lists are capped at 100 records per request.
- Media metadata is normalized in PostgreSQL while bytes stay in the selected
  storage provider.
- Local media paths are validated before reads/writes and never placed in the
  bundled `public` directory.
- Generated covers are stored as normal ordered media with `source = "ai"`.
- Stock balances are transactionally updated alongside their append-only
  movements; serialized unit changes use the same ledger.
- The initial migration and seed script are idempotent.
