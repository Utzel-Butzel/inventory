# Public workshop demo

The public product demo is an opt-in, read-only organization inside an existing
Open Inventory deployment. Set `DEMO_ACCESS_ENABLED=true` to reconcile the
fixed `demo` organization after database migrations and enable the dedicated
sign-in flow implemented by the application.

The seed is intentionally deterministic and idempotent:

- organization: `Werkstatt Nord · Demo` (`/demo`)
- dedicated user: `demo@inventory.invalid`, active viewer, exactly one membership
- five workshop items and three places with stock history, serialized units,
  one active checkout, one maintenance case, one low-stock case, and one order
- one 62 × 35 mm label layout
- fixed UUIDs and a transaction-scoped PostgreSQL advisory lock

The demo account has no published password. Its stored bcrypt hash was created
from discarded random input and is not used by the dedicated demo provider.
Application-level read-only enforcement remains mandatory; the seed flag alone
must never be treated as an authorization boundary.

With local storage, the startup seed verifies and copies the bundled context
photos into the persistent upload volume before inserting their media records.
For non-local storage providers, the data seed still succeeds but omits those
media rows because uploading to an external service would require provider-
specific write behavior.

Run manually only when intentionally enabling the public demo:

```bash
DEMO_ACCESS_ENABLED=true npm run db:seed:demo
```

`DEMO_ORGANIZATION_SLUG` and `DEMO_USER_EMAIL` default to `demo` and
`demo@inventory.invalid`. If the login configuration overrides either one, the
seed must receive the same values. Changing them after the fixed identity has
been created fails closed instead of silently renaming an account.

To remove the additive demo data again, disable the public entry point and run:

```bash
npm run db:seed:demo:remove
```

Cleanup locks and verifies the fixed organization by ID, expected name,
configured slug, read-only flag, and sole active viewer membership. It never
deletes by slug. The fixed demo user is removed only if it has no other
membership, and only the three exact `demo/*.webp` media paths are unlinked.

See [`assets/README.md`](assets/README.md) for photo sources and licensing.
