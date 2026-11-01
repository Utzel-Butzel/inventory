# Public workshop demo

The public product demo is an opt-in, read-only organization inside an existing
Open Inventory deployment. Set `DEMO_ACCESS_ENABLED=true` to reconcile the
fixed `demo` organization after database migrations and enable the dedicated
sign-in flow implemented by the application.

The seed is intentionally deterministic and idempotent. On reconciliation it
first verifies the fixed identity fail-closed, then recreates that disposable
tenant from the manifest so stale records, shares, tokens, jobs, or media rows
from an older demo cannot remain public:

- organization: `Werkstatt Nord · Demo` with the reserved slug `demo`
- dedicated user: `demo@inventory.invalid`, active viewer, exactly one membership
- saved default `Raster` view for inventory and favorites; Akku-Bohrschrauber
  18 V and Lötstation 80 W are the viewer's two favorites
- five workshop items and three places, each with three Imagegen-generated
  pictures (cover, additional perspective, detail) and descriptive content,
  plus 68 dated item bookings over 95 days, serialized units,
  one active checkout, one maintenance case, one low-stock case, and one order
- one 62 × 35 mm label layout
- one interactive material-withdrawal scan example for Projekt Lastenrad:
  enter `VERB-KB-200-S`, choose a purpose and a quantity (e.g. 12), then preview
  cable ties going from 34 to 22 pieces; confirmation remains disabled
- a real office RoomPlan scan under Werkbank E1, with the demo soldering station
  and multimeter positioned on its tables (`/demo/spaces`)
- fixed UUIDs and a transaction-scoped PostgreSQL advisory lock

The stock forecast has full 90-day curves from real ledger rows. Screws show
regular assembly consumption, two 200-piece receipts, an unused-material
return, damaged parts and a count correction (126 pieces remaining). Cable ties
show accelerating demand during the cargo-bike pilot series, two 100-piece
receipts and an open 100-piece order: at 7.2 pieces/day, the remaining 34 pieces
run out shortly before the delivery due in five days. Tool curves show loans,
returns, expansion of the soldering workspace and maintenance without treating
temporary unavailability as consumption. All dates are relative to seed startup.

The demo account has no published password. Its stored bcrypt hash was created
from discarded random input and is not used by the dedicated demo provider.
Application-level read-only enforcement remains mandatory; the seed flag alone
must never be treated as an authorization boundary.

`office-room-scene.json` is the owner's office geometry, approved for the public
demo on 2026-11-01. It retains seven surfaces and ten furniture objects from the
room scan shown in the Reddit draft. Map coordinates, photographs, keyframes,
AI analysis, native AR assets and original inventory records are not included.
The two demo item positions are illustrative manual placements. The startup
seed recreates this scene with the rest of the demo on every deployment.

With local storage, the startup seed verifies and copies the bundled context
images into the persistent upload volume before inserting their media records.
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
membership, and only the exact `demo/*.webp` media paths in the manifest are unlinked.

See [`assets/README.md`](assets/README.md) for image provenance and prompts.
The dedicated isolated deployment is documented in
[`../deploy/demo/README.md`](../deploy/demo/README.md).
