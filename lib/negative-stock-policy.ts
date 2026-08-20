export function violatesNegativeStockPolicy(options: {
  allowNegativeStock: boolean;
  quantityBefore: number;
  quantityAfter: number;
}) {
  return (
    !options.allowNegativeStock &&
    options.quantityAfter < 0 &&
    options.quantityAfter < options.quantityBefore
  );
}
