const canEncodeCode128B = (value: string) =>
  value.length > 0 &&
  value.length <= 120 &&
  Array.from(value).every((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code <= 126;
  });

export function printableLabelBarcode(resource: {
  id: string;
  barcode?: string | null;
  sku?: string | null;
}) {
  const preferred =
    resource.barcode?.trim() || resource.sku?.trim() || resource.id;
  return canEncodeCode128B(preferred) ? preferred : resource.id;
}
