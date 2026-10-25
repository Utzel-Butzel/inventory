// Embed the same locally hosted font in the SVG rasterization used by QZ.
// Browser previews/printing load this face through label-printer.module.css.
let barlowCss: Promise<string> | undefined;
export async function labelFontEmbedCss(node: HTMLElement): Promise<string> {
  const usesBarlow = Array.from(node.querySelectorAll<HTMLElement>("span")).some(
    element => getComputedStyle(element).fontFamily.includes("Inventory Barlow Semi Condensed"),
  );
  if (!usesBarlow) return "";
  await document.fonts.load('700 16px "Inventory Barlow Semi Condensed"');
  barlowCss ??= (async () => {
    const response = await fetch("/fonts/label-print/BarlowSemiCondensed-Bold.ttf");
    if (!response.ok) throw new Error("Unable to load label font.");
    const blob = await response.blob();
    const source = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Unable to embed label font."));
      reader.readAsDataURL(blob);
    });
    return `@font-face { font-family: "Inventory Barlow Semi Condensed"; src: url("${source}") format("truetype"); font-weight: 700; font-style: normal; }`;
  })().catch(error => { barlowCss = undefined; throw error; });
  return barlowCss;
}
