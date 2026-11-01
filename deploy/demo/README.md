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

- Open `/login?demo=1`, enter the demo, and browse all eight records. Each has
  its original cover and two additional gallery images (24 images in total),
  including Regal A2, Werkbank E1, and Fach K3.
- Inventory and Favorites start in the saved `Raster` view. Favorites contains
  Akku-Bohrschrauber 18 V and Lötstation 80 W, both starred in the full inventory.
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
- Source: `codex/isolated-public-demo`; deployed app commit `b998fae`.
- Deployment completed successfully. App and database are healthy; gateway
  is running; the one-time secrets initializer exited successfully.
- Verified in the running app container: only the isolated network is attached,
  no default gateway, external connection blocked, no paid-provider settings,
  all three workers disabled, gateway health HTTP 200.
- Ran `smoke.mjs` through the internal gateway: demo authentication and viewer
  role, read-only organization, eight records, five image checksums, 22 denied
  requests before/after login, Server Action denial, inventory page and CSP pass.
- Public DNS is configured at 1blu: `demo.openinventory` A `89.167.19.103`.
  Both authoritative nameservers and public resolvers confirm the record.
- HTTPS uses a valid Let's Encrypt certificate for the demo hostname. HTTP
  redirects to HTTPS; the landing-page redirect stays on the public origin.
- The complete smoke test also passes externally over verified HTTPS, including
  all 22 denied requests and all five image checksums. A process-local DNS
  override selected the verified server IP because the owner's router retained
  the previous negative DNS answer. TLS validation was not disabled. Browser
  verification on that connection remains subject to the DNS cache expiring.

## Content update, 2026-11-01

- Source: `codex/demo-location-images`; deployed app commit `5937ce6`.
- Seed v3 includes eight generated covers: all five items and all three places.
  Location descriptions and notes explain storage, maintenance, and replenishment.
- Production build completed and the app and database are healthy. Restarted
  only the gateway after the app replacement to refresh its upstream address.
- External HTTPS smoke checks pass for all eight resource/media associations,
  selected covers, descriptions, notes, alt text, WebP responses, and checksums.
  Demo viewer login, read-only state, 22 denied requests, CSP, and Server Action
  denial also pass.
- Browser verification confirms all eight images render in the inventory,
  including the three new location cards.

## Gallery update, 2026-11-01

- Source: `codex/demo-location-images`; deployed app commit `4a1de49`.
- Seed v4 gives all five items and all three places three images each. The
  original cover remains at position 0, with a new perspective and detail at
  positions 1 and 2. The 16 new WebP files total approximately 3.1 MB.
- Production build and deployment succeeded; app and database are healthy.
  Restarted the gateway after replacing the app to refresh its upstream address.
- External HTTPS smoke checks pass for all 24 image files, resource associations,
  ordered galleries, unchanged covers, alt text, descriptions, and checksums.
  Viewer login, read-only state, 22 denied requests, CSP, and Server Action denial
  also pass.
- Browser checks on Regal A2 and Akku-Bohrschrauber 18 V confirm the cover and
  both additional images render, and both new images open and switch correctly
  in the image viewer.
- The seven manifest tests, JavaScript syntax checks, and focused ESLint pass.

After changing the mounted Nginx config, restart only the `gateway` container
after deployment. Compose does not necessarily recreate it when file contents
change. This also refreshes its upstream address after an app replacement.

Repeat the external checks with:

```sh
node deploy/demo/smoke.mjs
```

## Office room update, 2026-11-01

- Source: `codex/demo-office-room`; deployed app commit `a746f3e`, building on
  the existing 24-image gallery deployment (`4a1de49`).
- `/demo/spaces` now includes the actual office scan under Werkbank E1, with
  illustrative placements for the demo soldering station and multimeter.
- The scan is bundled into the startup seed, so reconciliation restores it.
- Production build and container health passed. External HTTPS smoke checks
  verified seven surfaces, ten furniture objects, two demo placements, all
  24 images, viewer login, read-only organization, 22 denied requests, CSP and
  Server Action denial. Browser verification confirmed the rendered room and
  both item cards. No gateway restart was needed for this deployment.
- No source inventory records, keyframe photos, AR assets, AI analysis or map
  location were copied into the demo.

## Grid and favorites update, 2026-11-01

- Source: `codex/demo-office-room`; deployed app commit `4a047da`, combining
  the current office scan with the grid/favorites change from `9dc4dbb`.
- Seed v5 saves `Raster` as the demo viewer's default for both inventory and
  favorites, and stars Akku-Bohrschrauber 18 V and Lötstation 80 W.
- Build and container health passed. The external HTTPS smoke test uses a new
  viewer session and confirms both saved defaults, exactly two favorites in
  inventory and the favorites filter, all 24 images, the room scene, and the
  existing read-only checks. Browser navigation confirms both pages open as
  grids and show the two filled stars. No gateway restart was needed.
- Manifest tests, saved-view schema validation, syntax checks and focused
  ESLint passed.
