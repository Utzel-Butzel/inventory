import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  roomFurnitureReferenceVariants,
  type RoomFurnitureVariant,
} from "@/lib/room-furniture-catalog";

const previews = new Map<RoomFurnitureVariant, Promise<string | null>>();
export async function roomFurnitureReferenceImages(
  categories: readonly string[],
) {
  const variants = roomFurnitureReferenceVariants(categories);
  const references = await Promise.all(
    variants.map(async (variant) => {
      let image = previews.get(variant);
      if (!image) {
        image = readFile(
          path.join(
            process.cwd(),
            "public",
            "models",
            "room-furniture",
            "v1",
            `${variant}.png`,
          ),
        )
          .then((bytes) => `data:image/png;base64,${bytes.toString("base64")}`)
          .catch(() => null);
        previews.set(variant, image);
      }
      return { variant, image: await image };
    }),
  );
  return references.flatMap((reference) =>
    reference.image
      ? [
          {
            type: "input_text" as const,
            text: `CATALOG REFERENCE ONLY — not a scan photo or evidence of an object in the room. modelVariant=${reference.variant}. Compare construction; fit to measured dimensions.`,
          },
          {
            type: "input_image" as const,
            image_url: reference.image,
            detail: "low" as const,
          },
        ]
      : [],
  );
}
