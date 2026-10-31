# Konglomerat OpenInventory

Dedicated production instance on the existing Konglomerat Dokploy server.

- Dokploy: https://tools.konglomerat.org/dashboard/project/Byjxo6dM0EqU48EAyV52j/environment/xdyIwxIydtmp4ha4Xjae7/services/compose/4Wi7UeDJxPxbrMMNaZ7Fc
- Project/environment: `Konglodigital` / `production`.
- Compose ID: `4Wi7UeDJxPxbrMMNaZ7Fc`.
- Compose project: `konglo-openinventory-wz8tqj`.
- Server: `62.238.5.100`, SSH alias `konglo-server`.
- Organization: `Konglomerat e.V.`, slug `konglomerat`.
- Canonical origin: `https://inventar.konglomerat.org`.
- Previous temporary origin: `https://konglo-inventar.62-238-5-100.sslip.io`
  (still attached while DNS caches expire).

`compose.yaml` is the raw Compose definition stored in Dokploy. Secrets are
stored in Dokploy's Environment settings; they are not part of this repository.
The app runs the tested local image `konglo-openinventory:video-preview-20261031`,
image ID `sha256:95044c1bf6b2e7f2589573b859c854f28faaece73f79124f7c1fa375487e612b`.
It is built from commit `60dadb70c1e3acde4e83fdae478d1a926554793a` plus the
video-preview changes, excluding unrelated local changes. `pull_policy: never`
keeps Dokploy from replacing this local release. The image archive and a
reproducible source-change bundle are kept with the migration backups below.

## Access and bootstrap

The initial account is `admin@inventory.local`, with organization administrator
and deployment superadmin permissions. Its unique generated password is handed
over separately. Change it under Settings → Users after the first sign-in.

The account has already been created and verified. The bootstrap password and
its one-time flag have been removed from the running configuration. This file
therefore expects the existing database volume; for a new installation, follow
the bootstrap procedure in `../dokploy/README.md` first.

## Final domain

Configured on 2026-10-31 in the existing INWX `konglomerat.org` zone:

| Name | Type | Value | TTL |
| --- | --- | --- | --- |
| `inventar` | A | `62.238.5.100` | 300 seconds |

All three authoritative INWX nameservers and public resolvers `1.1.1.1` and
`8.8.8.8` confirmed the record. Dokploy routes HTTPS to `inventory:3000` with
a valid Let's Encrypt certificate. `AUTH_URL=https://inventar.konglomerat.org`
is deployed. HTTP redirects to HTTPS (308).

The previous temporary domain can be removed from this Compose service after
users have switched to the canonical address.

## Storage and operations

PostgreSQL only joins the private internal `backend` network and publishes no
host ports. Only the app joins `dokploy-network` for reverse proxy access.
Dokploy's service network setting explicitly detaches `konglo-inventory-db`
from the shared Dokploy network.

Persistent volumes:

- `konglo-openinventory-wz8tqj_inventory-postgres`
- `konglo-openinventory-wz8tqj_inventory-uploads`

Back up both PostgreSQL and uploads before updates. No scheduled backup has been
configured by this deployment. Do not remove these volumes when stopping or
redeploying the instance. To stop this deployment, use Stop on this Compose
service in Dokploy.

The app has a 768 MiB memory limit and PostgreSQL 384 MiB. Docker logs rotate at
10 MiB with three files. Password login is enabled; demo access and general
organization creation are disabled. No external AI credentials or SSO providers
have been configured.

## Verification

Setup checks on 2026-10-31:

- App and database Docker health checks passed.
- `/api/health` confirmed database, migrations, and writable upload storage.
- Anonymous inventory API access returned 401.
- Administrator login, organization rename, and authenticated inventory page
  passed; the new inventory contains no sample resources.
- PostgreSQL has only the private backend network and no published ports.
- Runtime bootstrap credentials were removed after successful account creation.

- External HTTPS checks on the temporary sslip.io origin passed with normal
  certificate validation: health, administrator login, the persisted Konglomerat
  organization, and the empty inventory page. HTTP redirects to HTTPS (308).
- The German login page was also verified in the browser.
- Final hostname checks also passed: valid TLS, health, anonymous API denial,
  administrator login, persisted organization, and authenticated inventory page.
  The local resolver/browser retained the previous NXDOMAIN response, so these
  final HTTPS checks used a process-local DNS override to the independently
  verified server IP. TLS validation remained enabled. No system DNS settings
  were changed.


## Inventory migration, 2026-10-31

Completed from the Konglodigital Supabase `resources`, `resource_links` and
`resource_pretty_titles` tables. The old application and its source data remain
unchanged. The approved scope excludes all 57 `project`/Showcase records and
Campai integration; OpenInventory authorization remains unchanged.

- 596 inventory records, retaining IDs, names, descriptions, tags, types,
  priorities, GPS/altitude and original creation/update timestamps.
- 585 points and 22 polygon outlines; polygon rings were closed without moving
  any vertex. Native spatial synchronization derived 545 containment edges.
- 84 native related-item edges; 50 references to excluded Showcases were retained
  as original-site URLs in notes.
- 1,302 original media files plus one video preview and one poster image, copied
  byte-for-byte into the persistent uploads volume. All 1,304 SHA-256 checksums
  match the source originals (586,189,184 bytes).
- All 596 current slugs and 26 compatible historical aliases are native slugs.
  Another 156 historical aliases containing non-ASCII characters remain in notes;
  they are not routes in OpenInventory.

Migration 0073 adds nullable preview/poster attachment references. The editor can
assign existing attachments from the same item. Detail and public-share views
play previews with posters, link to the original and hide supporting attachments
from the gallery. Media delivery supports HTTP byte ranges. Removing a supporting
attachment clears its reference. Normal media permissions and share revocation
continue to apply; no public share was created on production.

`prepare-migration.py` reads `source-snapshot-approved.json`, downloads/resumes
original files, writes a checksum manifest and produces a transaction-only SQL
import that refuses a nonempty target organization. `verify-migration.py` compares
all imported fields, geometry, media metadata/references, slugs and relationships
against the snapshot. The full import was tested in an isolated database first.

Secure operator artifacts:

- Local: `~/.config/openinventory/migration-konglomerat-20261031/`
- Server: `/root/openinventory-migration-20261031/`
- `target-before.sql`, `uploads-before.tar.gz`, `dokploy-before.json` (local),
  `import.sql`, `media.sha256`, `media-manifest.json`, release manifest and source
  patch bundle. The source snapshot and verification reports are retained locally.
- Server image archive: `konglo-video-preview-image.tar.gz`, SHA-256
  `0b5e08c48eaff9bd81e7ae9ae6d4959abdffb062f5875268d2e13fa7133e5bd4`.

To reproduce the release: check out the base commit in a clean directory, extract
`video-preview-changes.tar.gz` over it, and build with the normal Dockerfile for
`linux/amd64`. Loading the retained image archive with `docker load` is sufficient
for restoring this deployment on the same architecture. Never restore the empty
pre-import database over subsequent user edits without making a fresh backup.

Verification: production build and TypeScript passed; 30 media/preview/range tests
and 4 localization tests passed. The isolated API test rejected cross-item and
self-referencing previews, exercised public delivery and revocation, and checked
transaction refusal on a repeated import. Production checks confirmed all records,
file hashes, health, admin login, anonymous media denial, preview byte ranges,
and the visible inventory. Video playback was also verified in the browser.
