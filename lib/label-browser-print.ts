import { repeatLabelCopies } from "@/lib/label-print-copies";
import { readyLabelDimensions } from "@/lib/label-print-dimensions";

/** Print copies of a rendered draft, isolated from the editor and the prepared queue. */
export async function printBrowserLabel(node: HTMLElement, widthMm: number, heightMm: number, copies = 1) {
  ({ widthMm, heightMm } = await readyLabelDimensions(node, widthMm, heightMm));
  const pages = repeatLabelCopies([node], copies);
  const frame = document.createElement("iframe");
  frame.title = "Label print preview";
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", left: "-10000px", top: "0", width: "1200px", height: "800px", border: "0" });
  document.body.append(frame);
  const cleanup = () => frame.remove();
  try {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) throw new Error("Unable to open the print preview.");
    const base = doc.createElement("base");
    base.href = document.baseURI;
    doc.head.append(base);
    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"],style'));
    const loading = styles.map(source => {
      const copy = source.cloneNode(true) as HTMLElement;
      const ready = copy.tagName === "LINK" ? new Promise<void>((resolve, reject) => {
        copy.addEventListener("load", () => resolve(), { once: true });
        copy.addEventListener("error", () => reject(new Error("Unable to load label styles.")), { once: true });
      }) : Promise.resolve();
      doc.head.append(copy);
      return ready;
    });
    const printStyle = doc.createElement("style");
    printStyle.textContent = `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; } html,body { margin:0!important; padding:0!important; background:white!important; } article { margin:0!important; box-shadow:none!important; break-after:page; page-break-after:always; } article:last-child { break-after:auto; page-break-after:auto; }`;
    doc.head.append(printStyle);
    for (const page of pages) doc.body.append(page.cloneNode(true));
    await Promise.race([
      Promise.all([...loading, ...Array.from(doc.images, img => img.decode())]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Print preview timed out.")), 10000)),
    ]);
    await doc.fonts.ready;
    await new Promise<void>(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())));
    win.addEventListener("afterprint", cleanup, { once: true });
    // Some browsers return before their print dialog closes.
    setTimeout(cleanup, 300000);
    win.focus();
    win.print();
  } catch (error) { cleanup(); throw error; }
}
