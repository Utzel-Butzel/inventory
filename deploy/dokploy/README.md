# Dokploy deployment

This bundle contains Open Inventory, PostgreSQL, automatic secrets, health
checks, migrations, and persistent database and upload volumes.

1. Create a **Docker Compose** service in Dokploy.
2. Open **Advanced → Import** and paste all of [`base64.txt`](base64.txt) into
   the Base64 import field.
3. Choose the HTTPS hostname and select **Deploy**.
4. Reveal `BOOTSTRAP_ADMIN_PASSWORD` under **Environment** and sign in as
   `admin@inventory.local`.
5. Change that password under **Settings → Users**. Then remove the two
   `BOOTSTRAP_ADMIN_PASSWORD*` mappings and the generated secret and redeploy.

The template pulls `ghcr.io/utzel-butzel/inventory:latest`. That package must be
publicly readable; release maintainers publish it with the repository's
container-image workflow and make the GHCR package public once after creation.

To add the bundled public product demo to an existing deployment, set
`DEMO_ACCESS_ENABLED=true` on the `inventory` service and redeploy. The startup
process reconciles the fixed, read-only `Werkstatt Nord · Demo` organization
after migrations. `DEMO_ORGANIZATION_SLUG` and `DEMO_USER_EMAIL` default to
`demo` and `demo@inventory.invalid` and must match the app's demo-login
configuration.

For a deliberate rollback, first stop exposing the demo entry point and run
`node scripts/seed-demo.mjs --remove` inside the app container. The cleanup
deletes only the fixed organization ID after verifying its expected name, slug,
read-only flag, and sole viewer membership. It never deletes by slug. It removes
the fixed user only when no other membership exists, and unlinks only the three
known local demo media keys.

See the root [README](../../README.md#dokploy) for verification, updates, and
backups.
