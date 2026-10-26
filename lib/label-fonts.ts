// Embed the same locally hosted font faces used by browser previews/printing.
const barlowCss = new Map<number, Promise<string>>();
const barlowFaces = { 300: "Light", 400: "Regular", 700: "Bold" } as const;

export async function labelFontEmbedCss(node: HTMLElement): Promise<string> {
  const weights = new Set<keyof typeof barlowFaces>();
  for (const element of node.querySelectorAll<HTMLElement>("span")) {
    const style = getComputedStyle(element);
    if (!style.fontFamily.includes("Inventory Barlow Semi Condensed")) continue;
    const weight = Number(style.fontWeight);
    weights.add(weight <= 350 ? 300 : weight <= 550 ? 400 : 700);
  }
  const faces = await Promise.all([...weights].map(async weight => {
    await document.fonts.load(`${weight} 16px "Inventory Barlow Semi Condensed"`);
    if (!barlowCss.has(weight)) {
      const embedded = (async () => {
        const response = await fetch(`/fonts/label-print/BarlowSemiCondensed-${barlowFaces[weight]}.ttf`);
        if (!response.ok) throw new Error("Unable to load label font.");
        const blob = await response.blob();
        const source = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Unable to embed label font."));
          reader.readAsDataURL(blob);
        });
        return `@font-face { font-family: "Inventory Barlow Semi Condensed"; src: url("${source}") format("truetype"); font-weight: ${weight}; font-style: normal; }`;
      })().catch(error => { barlowCss.delete(weight); throw error; });
      barlowCss.set(weight, embedded);
    }
    return barlowCss.get(weight)!;
  }));
  return faces.join("\n");
}
