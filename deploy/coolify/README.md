# Coolify deployment

This service definition contains Open Inventory, PostgreSQL, automatic secrets,
health checks, migrations, and persistent database and upload volumes.

1. Choose **New Resource → Docker Compose Empty** in Coolify.
2. Paste all of [`compose.yaml`](compose.yaml), save it, and assign an HTTPS
   domain to the `inventory` service on port `3000`.
3. Select **Deploy**.
4. Reveal `SERVICE_PASSWORD_64_ADMIN` and sign in as
   `admin@inventory.local`.
5. Change that password under **Settings → Users**. Then remove the two
   `BOOTSTRAP_ADMIN_PASSWORD*` mappings, rotate the generated admin secret, and
   redeploy.

The definition pulls `ghcr.io/utzel-butzel/inventory:latest`. That package must
be publicly readable; release maintainers publish it with the repository's
container-image workflow and make the GHCR package public once after creation.

Set `DEMO_ACCESS_ENABLED=true` on the `inventory` service to reconcile the
bundled read-only workshop demo after migrations. The matching optional values
are `DEMO_ORGANIZATION_SLUG=demo` and
`DEMO_USER_EMAIL=demo@inventory.invalid`. Disable the entry point before a
rollback, then run `node scripts/seed-demo.mjs --remove` in the app container.
That command verifies and removes only the fixed demo IDs and exact local media
keys; it never deletes an organization by slug.

This file follows Coolify's one-click service format and can be submitted to the
catalog together with [`open-inventory.svg`](open-inventory.svg). Until it is
accepted there, **Docker Compose Empty** is the direct import path. See the root
[README](../../README.md#coolify) for verification, updates, and backups.
