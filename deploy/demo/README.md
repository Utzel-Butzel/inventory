# Isolated public demo

Target: `https://demo.openinventory.polyxo.de` on `tools.paperlesspaper.de`.
Use this Compose bundle as a separate Dokploy Compose service, with repository
source and Compose path `deploy/demo/compose.yaml`. Do not reuse production
volumes, credentials, databases, or environment files.

The bundle generates its database password and session secret once into a
private Docker volume. It starts PostgreSQL, migrates and seeds the dedicated
demo tenant, and serves only the viewer login. No paid API credentials are
passed to the application. All three background workers and MCP are disabled.

The application and database join only an `internal: true` Docker network:
they cannot reach Internet services. Only the Nginx gateway joins the existing
`dokploy-network`. There are no published host ports. Traefik routes HTTPS to
the gateway on port 8080 and redirects HTTP to HTTPS.

The gateway rejects every method except GET/HEAD, with exact POST exceptions
for the demo login and logout. It also rejects Next Server Actions and the AI,
cron, MCP and webhook namespaces, including GET requests. Bodies are limited
to 8 KiB for authentication. The application's tenant permission checks remain
in force behind the gateway. A CSP blocks browser connections to external APIs
and tile services; the map may therefore lack external background tiles.

Images are bundled during the build and copied to local storage by the seed.
Visitors cannot upload files. Imagegen was used during asset preparation, never
from the running demo. Hosting still uses the existing server's resources;
this setup prevents visitor-triggered paid AI, storage, mail and integrations.

Set the DNS A record `demo.openinventory.polyxo.de` to `89.167.19.103` at 1blu.
Do not add an AAAA record unless the server's IPv6 routing is also configured.
The existing Traefik `letsencrypt` resolver issues the certificate.

Validation after deployment:

- Open `/login?demo=1`, enter the demo, browse inventory and all five images.
- Check unauthenticated and authenticated POST/PATCH/DELETE requests return 403.
- Check GET and POST under `/api/v1/ai/` return 403.
- Verify the application container has only the internal network, no provider
  credentials, disabled workers, and cannot connect to external IPs.
- Confirm the tenant is read-only and has exactly one active viewer membership.

For rollback, stop this dedicated Compose service. Keep its three named volumes
until its data is no longer needed. No production service needs modification.

## Deployment status, 2026-10-31

- Dokploy project: `Open Inventory Demo`, environment `production`.
- Compose ID: `hrfnQxCpETSuGEKnSFf90`.
- Compose project: `open-inventory-demo-demo-0oyjjw`.
- Source: `codex/isolated-public-demo`; deployed app commit `759f503`.
- Deployment completed successfully. App and database are healthy; gateway
  is running; the one-time secrets initializer exited successfully.
- Verified in the running app container: only the isolated network is attached,
  no default gateway, external connection blocked, no paid-provider settings,
  all three workers disabled, gateway health HTTP 200.
- Ran `smoke.mjs` through the internal gateway: demo authentication and viewer
  role, read-only organization, eight records, five image checksums, 22 denied
  requests before/after login, Server Action denial, inventory page and CSP pass.
- Public DNS/HTTPS remain pending: 1blu requires the owner's login before the
  A record can be created. The public origin has not yet been browser-tested.

After DNS and HTTPS are available, repeat the external checks with:

```sh
node deploy/demo/smoke.mjs
```
