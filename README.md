# Inventory

Inventory is a self-hosted inventory workspace built with Next.js, Tailwind CSS,
PostgreSQL, and Drizzle ORM. It combines practical inventory CRUD with media
management, traceable stock control, camera-first batch capture, AI image
analysis, AI cover generation, duplicate merging, location views, and a scoped
bearer-token API.

## Included

- Responsive dashboard, searchable grid/table inventory, and item editor
- Interactive street/satellite map with point and polygon editing, draggable
  geometry handles, layers, keyboard shortcuts, map selection, and multi-item
  quick edits
- Tools, objects, furniture, vehicles, places, people, clothing, projects, and
  custom “other” records
- Quantities, status, SKU, serial number, value, categories, tags, location,
  notes, GPS, GeoJSON-compatible map features, priority, and ordered media
- Bulk and serialized stock tracking with immutable dated movement history
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
- Photo-based counting with a reviewable quantity before stock receipt or issue
- OpenAI image-to-record analysis with structured title, description, type,
  tags, alt text, and confidence output
- OpenAI or Google image editing for clean square studio covers
- Local persistent file storage or Openinary
- Multiple local user accounts with admin, editor, and viewer roles, plus optional Auth0
- Hashed, scoped, expiring, revocable API tokens
- Duplicate scoring and transactional record merging
- Docker Compose deployment with PostgreSQL and persistent volumes

## Local setup

Requirements: Node.js 22.13 or newer and PostgreSQL 15 or newer.

```bash
npm install
cp .env.example .env.local
createdb inventory
npm run db:migrate
npm run db:seed
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). Change the values in
`.env.local` before using the app outside a local development machine.

The map defaults to OpenFreeMap streets and Esri satellite imagery, so it needs
no Mapbox token. Point `NEXT_PUBLIC_MAP_STYLE_URL` and
`NEXT_PUBLIC_SATELLITE_TILE_URL` at your own compatible tile services when the
deployment must keep map traffic on infrastructure you control.

On an empty database, the first local administrator can be bootstrapped with:

```dotenv
BOOTSTRAP_ADMIN_EMAIL=admin@inventory.local
BOOTSTRAP_ADMIN_NAME=Inventory admin
BOOTSTRAP_ADMIN_PASSWORD_HASH=$2b$12$...
```

The legacy `SIMPLE_AUTH_*` values remain a fallback while the user table is
empty. Plaintext `BOOTSTRAP_ADMIN_PASSWORD` or `SIMPLE_AUTH_PASSWORD` is only
intended for local development and is rejected by the production container.

Generate a password hash with:

```bash
npm run auth:hash -- "your new password"
```

## Docker

The production Compose file has no default database password, application
secret, public URL, or plaintext login password. Create a `.env` file and set at
least:

```dotenv
POSTGRES_PASSWORD=a-long-url-safe-random-value
AUTH_SECRET=a-different-random-value-with-at-least-32-characters
AUTH_URL=https://inventory.example.com
SIMPLE_AUTH_EMAIL=admin@example.com
SIMPLE_AUTH_PASSWORD_HASH='$2b$12$...'
```

Keep bcrypt hashes in single quotes in Compose `.env` files so their `$`
characters remain literal. Generate both secrets before starting:

```bash
openssl rand -base64 48
npm run auth:hash -- "your new password"
```

For local access through port 3000, add the checked-in local port override:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

Compose starts PostgreSQL, applies checked-in migrations, and starts Inventory
at [http://localhost:3000](http://localhost:3000). Named volumes persist both
PostgreSQL data and local uploads across container replacements. Their explicit
names, `inventory_postgres` and `inventory_uploads`, remain stable even if the
Compose project name changes. Override `POSTGRES_VOLUME_NAME` and
`UPLOADS_VOLUME_NAME` when multiple installations share one Docker host.

The production image validates its required configuration, verifies local
storage permissions, applies migrations under a PostgreSQL advisory lock, and
then starts Next.js. It refuses a placeholder/short `AUTH_SECRET`, a non-HTTPS
remote `AUTH_URL`, plaintext `SIMPLE_AUTH_PASSWORD`, incomplete Auth0 settings,
or incomplete storage-provider settings. The Compose migration service remains
as an explicit deployment gate; the application repeats the idempotent check so
the same image also works as a standalone container.

### Dokploy

The simplest Dokploy setup is one **Application** built from this Dockerfile and
a separate managed PostgreSQL service:

1. Upload the project as a ZIP or connect a repository. Use the repository root
   as build context, `Dockerfile` as the Dockerfile, and do not override its
   start command.
2. Attach a managed PostgreSQL database and set its full, URL-encoded connection
   string as `DATABASE_URL`.
3. Set `AUTH_SECRET`, the exact public HTTPS origin as `AUTH_URL`, and
   `AUTH_TRUST_HOST=true`. For example, if the application is published at
   `https://inventory.example.com`, that exact value must be used.
4. Expose container port `3000` through the Dokploy domain and TLS settings. Set
   the health-check path to `/api/health`; it returns 200 only when PostgreSQL,
   every bundled migration, and the configured storage are ready.
5. For local file storage, set `STORAGE_PROVIDER=local`,
   `STORAGE_LOCAL_PATH=/app/data/uploads`, and attach a persistent volume at
   `/app/data/uploads`. The container runs as UID/GID `1001`, so a host bind
   mount must be writable by that identity. No upload volume is required when
   `STORAGE_PROVIDER=openinary` is fully configured.
6. Add a password hash/bootstrap administrator or complete Auth0 settings, then
   add the optional AI provider credentials. Never configure
   `SIMPLE_AUTH_PASSWORD` on the production container.

Deploy with one replica for migrations and AI rate limiting. The migration lock
makes concurrent starts safe, but the current AI limiter is process-local. Back
up PostgreSQL and `/app/data/uploads` together; database media rows and stored
files form one logical dataset. A deployment is not complete until login,
upload, API-token, stock-movement, container-recreation, and backup/restore
smoke tests have passed.

## Authentication

### Local accounts

For the first login on an empty database, configure:

```dotenv
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_NAME=Inventory admin
BOOTSTRAP_ADMIN_PASSWORD_HASH=$2b$12$...
```

The first matching successful login creates the database-backed administrator.
That administrator can then create, disable, re-enable, reset, and assign roles
to additional accounts under **Settings → Workspace users**. All accounts share
the same inventory workspace:

- `admin` manages users and API tokens and has full inventory and AI access.
- `editor` can read and change inventory and use AI features.
- `viewer` has read-only access.

After the first administrator exists, remove the bootstrap password hash from
the deployment environment. Existing database users continue to work. Disabling
a user or resetting a password invalidates that user’s existing sessions.

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
# Optional custom claim containing admin, editor, or viewer:
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
claim contains a supported role.

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

## File storage

### Local persistent storage

```dotenv
STORAGE_PROVIDER=local
STORAGE_LOCAL_PATH=./data/uploads
MAX_UPLOAD_MB=25
```

Files are kept outside the application bundle and streamed through an
authenticated same-origin route. In Docker, `/app/data/uploads` is backed by the
`inventory_uploads` volume.

### Openinary

```dotenv
STORAGE_PROVIDER=openinary
OPENINARY_BASE_URL=https://media.example.com
OPENINARY_API_KEY=...
```

Uploads use Openinary’s `/api/upload` endpoint with bearer authentication and
request common cached image sizes.

## AI features

Image analysis uses OpenAI’s Responses API:

```dotenv
OPENAI_API_KEY=...
OPENAI_VISION_MODEL=gpt-4.1-mini
# Optional; defaults to OPENAI_VISION_MODEL when omitted
OPENAI_COUNT_MODEL=
AI_OUTPUT_LANGUAGE=English
```

An OpenAI-compatible endpoint can be selected with `OPENAI_BASE_URL`.

The bulk-stock screen and native item detail can send one transient camera image
to the vision model, count the requested part, and copy the result into a stock
receipt or issue. The image is decoded, resized, and passed to the provider but
is not stored as inventory media. Counting can be uncertain when parts overlap,
are cropped, or are hidden, so the detected quantity and confidence are always
shown for review and can be corrected before the stock movement is submitted.

Cover generation can use OpenAI:

```dotenv
IMAGE_EDIT_PROVIDER=openai
OPENAI_IMAGE_EDIT_MODEL=gpt-image-1
```

Or Google:

```dotenv
IMAGE_EDIT_PROVIDER=google
GOOGLE_AI_API_KEY=...
GOOGLE_IMAGE_EDIT_MODEL=gemini-2.5-flash-image
```

AI routes are authenticated, scope-checked, upload-limited, and protected by
per-process rate limits. For a multi-replica public deployment, replace the
in-memory limiter with a shared Redis-compatible limiter.

## API tokens

Create tokens under **Settings → API access**. The plaintext token is shown
once; only its SHA-256 digest is stored. Available scopes are:

- `read`: list and retrieve records, files, statistics, and duplicate matches
- `write`: create, edit, delete, upload, reorder, and merge
- `ai`: run image analysis and cover generation

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

Upload media after creation:

```bash
curl -X POST "http://localhost:3000/api/v1/resources/RESOURCE_ID/media" \
  -H "Authorization: Bearer inv_your_token" \
  -F "files=@drill.jpg"
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
contract as JSON at `/openapi.json`; signed-in users can browse and test it in
the interactive API reference at `/api-docs`.

## Commands

```text
npm run dev          Start the development server
npm run build        Create a production build
npm run start        Start the production server
npm run lint         Run ESLint
npm run typecheck    Run TypeScript checks
npm run db:migrate   Apply checked-in PostgreSQL migrations
npm run db:seed      Add sample records when the database is empty
npm run db:generate  Generate a Drizzle migration after schema changes
npm run auth:hash    Generate a bcrypt password hash
```

## Architecture notes

- Session and bearer-token authorization are both enforced inside every data
  route; the dashboard layout redirect is not the security boundary.
- Lists are capped at 100 records per request.
- Media metadata is normalized in PostgreSQL while bytes stay in the selected
  storage provider.
- Local media paths are validated before reads/writes and never placed in the
  bundled `public` directory.
- Generated covers are stored as normal ordered media with `source = "ai"`.
- Stock balances are transactionally updated alongside their append-only
  movements; serialized unit changes use the same ledger.
- The initial migration and seed script are idempotent.
