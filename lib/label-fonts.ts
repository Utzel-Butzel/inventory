import { LABEL_FONT_FACES } from "@/lib/label-font-faces";

const embeddedFaces = new Map<string, Promise<string>>();

export function selectLabelFontFace(family: string, weight: number, style: string) {
  const families = family.split(",").map(name => name.trim().replace(/^["']|["']$/g, ""));
  const distance = (range: string) => {
    const [min, max = min] = range.split(" ").map(Number);
    return Math.max(min - weight, 0, weight - max);
  };
  return LABEL_FONT_FACES.filter(face => families.includes(face.family) && face.style === style)
    .toSorted((a, b) => families.indexOf(a.family) - families.indexOf(b.family) || distance(a.weight) - distance(b.weight))[0];
}

// Raster output uses the same actual faces (including italics and variable
// weights) as the preview. Fetch only the faces used by this label.
export async function labelFontEmbedCss(node: HTMLElement): Promise<string> {
  const used = new Set<(typeof LABEL_FONT_FACES)[number]>();
  for (const element of node.querySelectorAll<HTMLElement>("span")) {
    const style = getComputedStyle(element);
    const weight = Number(style.fontWeight);
    const face = selectLabelFontFace(style.fontFamily, weight, style.fontStyle);
    if (face) {
      await document.fonts.load(`${style.fontStyle} ${weight} 16px "${face.family}"`);
      used.add(face);
    }
  }
  return (await Promise.all([...used].map(face => {
    if (!embeddedFaces.has(face.file)) {
      const embedded = (async () => {
        const response = await fetch(`/fonts/label-print/${face.file}`);
        if (!response.ok) throw new Error("Unable to load label font.");
        const blob = await response.blob();
        const source = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Unable to embed label font."));
          reader.readAsDataURL(blob);
        });
        return `@font-face { font-family: "${face.family}"; src: url("${source}") format("truetype"); font-weight: ${face.weight}; font-style: ${face.style}; }`;
      })().catch(error => { embeddedFaces.delete(face.file); throw error; });
      embeddedFaces.set(face.file, embedded);
    }
    return embeddedFaces.get(face.file)!;
  }))).join("\n");
}
