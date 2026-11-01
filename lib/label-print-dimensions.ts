/** Wait for font-dependent layouts before capturing or cloning a printed label. */
export async function readyLabelDimensions(node: HTMLElement, fallbackWidthMm: number, fallbackHeightMm: number) {
  await document.fonts.ready;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  if (node.dataset.labelLayoutError) throw new Error(node.dataset.labelLayoutError);
  const widthMm = Number(node.dataset.labelWidthMm ?? fallbackWidthMm);
  const heightMm = Number(node.dataset.labelHeightMm ?? fallbackHeightMm);
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0 || widthMm > 1000 || heightMm > 1000) {
    throw new Error("Label dimensions exceed the print area (maximum 1000 mm). Shorten the text or reduce its font size.");
  }
  return { widthMm, heightMm };
}
