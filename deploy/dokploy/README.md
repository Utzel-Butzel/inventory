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

See the root [README](../../README.md#dokploy) for verification, updates, and
backups.
