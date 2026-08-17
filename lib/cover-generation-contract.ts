export const coverTransparencyMethods = [
  "greenscreen",
  "difference-matting",
] as const;

export type CoverTransparencyMethod =
  (typeof coverTransparencyMethods)[number];

export const defaultCoverTransparencyMethod =
  "difference-matting" satisfies CoverTransparencyMethod;

const backgroundInstructions: Record<CoverTransparencyMethod, string> = {
  greenscreen: `Transparency extraction requirements:
- Place the isolated subject on a pure, perfectly uniform chroma-green #00FF00 background.
- The green background must fill every pixel outside the subject, with no texture, gradient, horizon, vignette, border, or backdrop detail.
- Keep the subject's original colors unchanged and light its outline neutrally.
- Do not add green reflections, green rim light, green glow, color spill, or green color casts on the subject or its shadow.
- Keep the full subject separate from the image edges.`,
  "difference-matting": `Transparency extraction requirements:
- Place the isolated subject on a pure, perfectly uniform white #FFFFFF background.
- The white background must fill every pixel outside the subject, with no texture, gradient, horizon, vignette, border, or backdrop detail.
- Keep the full subject separate from the image edges.
- Preserve fine edges, openings, glass, translucent materials, and soft natural shadows.`,
};

export function coverPromptForTransparency(
  prompt: string,
  method: CoverTransparencyMethod,
) {
  return `${prompt.trim()}\n\n${backgroundInstructions[method]}`;
}

export const differenceMattingBlackPassPrompt = `Change only the pure white background to a pure, perfectly uniform black #000000 background.
Keep the subject, its position, scale, pixels, colors, lighting, fine edges, translucent details, and shadow exactly unchanged.
Do not redraw, restyle, move, crop, or alter the subject. The black background must fill every pixel outside it with no texture, gradient, horizon, vignette, border, or other detail.`;
