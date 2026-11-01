/** Never capture a placeholder or failed shortcode as a printable label. */
export async function readyLabelQr(node: HTMLElement, fallback?: string) {
  const started = Date.now();
  while (node.querySelector('[data-label-qr-state="pending"]')) {
    if (Date.now() - started > 25000) throw new Error("Label QR code is still loading. Please retry.");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const error = node.querySelector<HTMLElement>('[data-label-qr-state="error"]');
  if (error) throw new Error(error.dataset.labelQrError || "Unable to prepare the label QR code.");
  return node.querySelector<HTMLElement>("[data-label-qr-value]")?.dataset.labelQrValue ?? fallback;
}
