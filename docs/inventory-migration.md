# Inventory migration

Open **Settings → Data transfer** (`/settings/data`). Select the source system before choosing its CSV export, review the mapped columns and preview, then import. Select a destination system to download a CSV prepared for its importer. Native Open Inventory CSV, Excel and PDF downloads remain available.

## Supported profiles

| Profile | Import into Open Inventory | Export from Open Inventory |
| --- | --- | --- |
| Open Inventory | Existing native CSV schema | Native CSV, Excel, PDF |
| Snipe-IT assets | Asset tag → SKU; serial, location, category, purchase cost, name; one unit per asset | Asset Tag, Name, Model Name, Category, Status, Serial, Location, Purchase Cost, Notes |
| Homebox | `HB.*` CSV, including legacy `HB.labels` and current `HB.tags`; quantity, archive flag, location, serial, price | Homebox columns plus custom fields for SKU, barcode and currency |

Profiles follow [Snipe-IT's asset import documentation](https://snipe-it.readme.io/docs/importing-assets), [Homebox's CSV documentation](https://hay-kot.github.io/homebox/import-csv/) and the [current Homebox CSV row definition](https://github.com/sysadminsmedia/homebox/blob/main/backend/internal/core/services/reporting/io_row.go). There is no live API connection or background synchronization. Compatibility tests use representative CSV fixtures, not running installations of the destination products.

## Import behavior

- Files must be UTF-8, at most 5 MB, with at most 1,000 inventory rows. Foreign profiles detect comma, semicolon and tab separators. Quoted delimiters, multiline fields and UTF-8 BOMs are supported.
- The selected currency applies to foreign purchase prices without an explicit currency field. Prices accept a decimal point or comma with up to two decimals; thousands separators and ambiguous prices are rejected. Values are converted to cents without rounding away extra precision.
- Quantities must be whole numbers. Source serial numbers and asset tags stay textual, including leading zeroes.
- New items use the `object` inventory type. It must be active in the workspace.
- Snipe-IT's name falls back to Model Name, then Asset Tag. Common statuses are mapped; unknown statuses become `available` and remain in the notes as original text. Homebox's archive flag maps to `archived` or `available`.
- Unmapped columns, including source IDs, manufacturer, warranty and custom fields, are retained in notes with their original column names. They do not become configured Open Inventory custom fields. Excessively long notes produce a validation error, not silent truncation.
- Only new entries are created. Existing identifiers produce row errors. Retrying the same import in the same UI operation uses the same idempotency key. Changing the file, source profile or currency starts a new operation; selecting a file again is not a persistent synchronization mechanism.
- Structural CSV and conversion errors stop the file before writes. Resource validation and identifier conflicts are reported per row, with original source line numbers. Successful rows in a partial import remain created.

## Export behavior and limitations

Foreign CSV downloads contain mapped fields and supplementary text in Notes. This is a migration of inventory entries, **not a full backup**: attachments, images, users, loans, audit history and structured relationships are not recreated. Additional Open Inventory fields kept in notes are not automatically restored as structured fields on reimport. Keep a native export when preserving Open Inventory-specific structure matters.

**Snipe-IT:** Asset rows require exactly one unit. An export containing zero or multiple units in any entry fails with an actionable error; it never silently changes the count or duplicates serial numbers. The resource name is used as Model Name; the first category becomes Category, falling back to `Open Inventory`. SKU becomes Asset Tag, with `OI-<resource UUID>` as a fallback. Review model/category grouping, currency and status label configuration in Snipe-IT. A status label does not recreate a checkout. Asset tags can match and update existing records in Snipe-IT.

**Homebox:** Stable `open-inventory:<resource UUID>` import references support repeated destination imports. SKU, barcode and currency use `HB.field.Open Inventory …` fields. Portable exports enforce the documented 1,000-character Notes and 255-character Description limits and reject tags containing semicolons. Location paths use Homebox's slash hierarchy semantics. Existing Homebox entries with matching import references may be updated by its importer.

CSV text is protected against spreadsheet formula evaluation. Open Inventory removes its spreadsheet guard during imports; other products may retain the leading apostrophe in formula-like text.

## API

Existing authorization and organization scoping apply (`inventory.import` / `inventory.export`).

- `POST /api/v1/resources/import?system=homebox&currency=EUR` with a raw `text/csv` body and UUID `Idempotency-Key`.
- `POST /api/v1/resources/import?system=snipe-it&currency=USD` for asset CSV.
- `GET /api/v1/resources/export?system=homebox&format=csv`.
- `GET /api/v1/resources/export?system=snipe-it&format=csv`.
- Omitting `system` preserves the existing native behavior. Foreign export profiles support CSV only. Unrepresentable exports return HTTP 422 without a partial download.

Run the migration and route tests:

```sh
node --experimental-test-module-mocks --experimental-strip-types --experimental-loader ./tests/support/typescript-paths-loader.mjs --test tests/inventory-migration*.test.mjs
```
