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

The service forwards the optional `AUTH0_*`, `AUTH_OIDC_*`, and
`AUTH_PASSWORD_ENABLED` variables. Add them to the `inventory` service and
redeploy as described in the root
[authentication provider guide](../../README.md#authentication-providers).

## App name and logo

Add these optional values to the `inventory` service's environment and redeploy:

```dotenv
APP_NAME="My Inventory"
APP_LOGO_URL=https://example.com/logo.png
```

The name and logo appear in navigation and on the sign-in page for all
organizations; the name also appears in browser titles. Use a publicly
accessible HTTPS image URL. Empty values keep the built-in branding, and
unavailable images fall back to the built-in logo.

The current [`compose.yaml`](compose.yaml) forwards both variables. Copy those
two environment entries into older service definitions as well. After
deploying a version with branding support, later changes only require a
redeploy, without rebuilding the image. See the
[branding configuration guide](https://docs.openinventory.polyxo.de/configuration#app-name-and-logo).

## Demo access

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
