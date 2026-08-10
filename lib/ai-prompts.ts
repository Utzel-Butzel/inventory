export const defaultCoverPrompt = (title?: string) => `Isolate the ${
  title?.trim() || "inventory item"
} from the source photo on a pure warm-white background. Create polished high-end studio product photography with soft diffused lighting and a subtle natural shadow. Keep every real product detail accurate. Center the item, fill the frame without crowding it, remove background objects, and return one square 1:1 image with no text.`;
