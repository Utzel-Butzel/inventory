export const defaultCoverPrompt = (title?: string) =>
  `Isolate the "${
    title?.trim() || "inventory item"
  }" on the photo in front of a pure white background. Professional high-end studio lighting, similar to Apple product photography. Soft, diffused light with subtle natural shadows. Perfectly centered composition. Square aspect ratio. It should fit the frame. Not too much white space. Ultra-clean, sharp focus, high resolution, no additional objects. no frontal view. Make sure background is full white (#fff)`;

export const defaultTransparentCoverPrompt = (title?: string) =>
  `Isolate the "${
    title?.trim() || "inventory item"
  }" from the photo. Preserve its exact shape, proportions, colors, materials, fine edges, openings, and visible details. Professional high-end studio lighting, similar to Apple product photography. Perfectly centered square composition. It should fit the frame with minimal empty space. Ultra-clean, sharp focus, high resolution, no additional objects, backdrop, scenery, frame, or border.`;
