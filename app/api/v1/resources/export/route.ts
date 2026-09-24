import { requirePermission } from "@/lib/api-auth";
import {
  buildInventoryCsv,
  buildInventoryPdf,
  buildInventoryXlsx,
  inventoryExportRow,
  parseInventoryExportOptions,
  type InventoryExportFormat,
} from "@/lib/inventory-export";
import { listResources } from "@/lib/resources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;
const MAX_EXPORT_ROWS = 100_000;

const responseMetadata: Record<
  InventoryExportFormat,
  { extension: string; contentType: string }
> = {
  csv: { extension: "csv", contentType: "text/csv; charset=utf-8" },
  xlsx: {
    extension: "xlsx",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  pdf: { extension: "pdf", contentType: "application/pdf" },
};

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "inventory.export");
  if (authorization.response) return authorization.response;

  const exportOptions = parseInventoryExportOptions(request.url);
  if (!exportOptions) {
    return Response.json(
      { error: "Unsupported export format. Choose csv, xlsx, or pdf." },
      { status: 400 },
    );
  }

  const firstPage = await listResources({
    organizationId: authorization.identity.organizationId,
    page: 1,
    pageSize: PAGE_SIZE,
  });
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
    const result = await listResources({
      organizationId: authorization.identity.organizationId,
      page,
      pageSize: PAGE_SIZE,
    });
    exportedResources.push(...result.resources);
  }

  const rows = exportedResources.map(inventoryExportRow);
  const generatedAt = new Date();
  const date = generatedAt.toISOString().slice(0, 10);
  const metadata = responseMetadata[exportOptions.format];
  const body =
    exportOptions.format === "csv"
      ? buildInventoryCsv(rows)
      : exportOptions.format === "xlsx"
        ? new Uint8Array(
            await buildInventoryXlsx(rows, {
              generatedAt,
              locale: exportOptions.locale,
            }),
          )
        : new Uint8Array(
            await buildInventoryPdf(rows, {
              generatedAt,
              locale: exportOptions.locale,
            }),
          );

  return new Response(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition":
        `attachment; filename="inventory-${date}.${metadata.extension}"`,
      "Content-Type": metadata.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
