import { requirePermission } from "@/lib/api-auth";
import { listResources, type ResourceWithMedia } from "@/lib/resources";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;
const MAX_EXPORT_ROWS = 100_000;

const headers = [
  "id",
  "name",
  "description",
  "type",
  "status",
  "sku",
  "quantity",
  "location",
  "serial_number",
  "value_cents",
  "currency",
  "priority",
  "tags",
  "categories",
  "custom_fields",
  "related_resource_ids",
  "gps_latitude",
  "gps_longitude",
  "gps_altitude",
  "map_features",
  "notes",
  "created_at",
  "updated_at",
] as const;

type ExportHeader = (typeof headers)[number];

// Quoting alone does not stop spreadsheet applications from evaluating a cell
// as a formula. Prefixing risky text with an apostrophe is understood by common
// spreadsheet tools and is removed again by this app's importer.
const guardSpreadsheetFormula = (value: string) =>
  /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;

const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return '""';
  const text =
    typeof value === "string"
      ? guardSpreadsheetFormula(value)
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  return `"${text.replaceAll('"', '""')}"`;
};

const resourceRow = (
  resource: ResourceWithMedia,
): Record<ExportHeader, unknown> => ({
  id: resource.id,
  name: resource.name,
  description: resource.description,
  type: resource.type,
  status: resource.status,
  sku: resource.sku,
  quantity: resource.quantity,
  location: resource.location,
  serial_number: resource.serialNumber,
  value_cents: resource.valueCents,
  currency: resource.currency,
  priority: resource.priority,
  tags: JSON.stringify(resource.tags),
  categories: JSON.stringify(resource.categories),
  custom_fields: JSON.stringify(resource.customFields),
  related_resource_ids: JSON.stringify(resource.relatedResourceIds),
  gps_latitude: resource.gpsLatitude,
  gps_longitude: resource.gpsLongitude,
  gps_altitude: resource.gpsAltitude,
  map_features: JSON.stringify(resource.mapFeatures),
  notes: resource.notes,
  created_at: resource.createdAt,
  updated_at: resource.updatedAt,
});

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "inventory.export");
  if (authorization.response) return authorization.response;

  const firstPage = await listResources({ page: 1, pageSize: PAGE_SIZE });
  if (firstPage.pagination.total > MAX_EXPORT_ROWS) {
    return Response.json(
      {
        error: `This export contains more than ${MAX_EXPORT_ROWS.toLocaleString("en-US")} rows. Narrow the inventory before exporting.`,
      },
      { status: 413 },
    );
  }

  const exportedResources = [...firstPage.resources];
  for (let page = 2; page <= firstPage.pagination.pages; page += 1) {
    const result = await listResources({ page, pageSize: PAGE_SIZE });
    exportedResources.push(...result.resources);
  }

  const csv = [
    headers.map(csvCell).join(","),
    ...exportedResources.map((resource) => {
      const row = resourceRow(resource);
      return headers.map((header) => csvCell(row[header])).join(",");
    }),
  ].join("\r\n");
  const date = new Date().toISOString().slice(0, 10);

  return new Response(`\uFEFF${csv}\r\n`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="inventory-${date}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
