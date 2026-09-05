import { z } from "zod";

export const roomFurnitureVariantSchema = z.enum([
  "wardrobe",
  "bookcase",
  "shelving",
  "sideboard",
  "drawers",
  "table",
  "chair",
  "sofa",
  "bed",
  "sliding-wardrobe",
  "cube-shelf",
  "wall-shelf",
  "kitchen-cabinet",
  "round-table",
  "desk",
  "coffee-table",
  "office-chair",
  "stool",
  "bench",
  "corner-sofa",
  "armchair",
  "single-bed",
  "bunk-bed",
  "refrigerator",
  "washer",
  "oven",
  "dishwasher",
  "toilet",
  "sink",
  "bathtub",
]);
export type RoomFurnitureVariant = z.infer<typeof roomFurnitureVariantSchema>;
export const roomFurnitureVariants = roomFurnitureVariantSchema.options;
export const roomFurnitureLibraryVersion = "blender-furniture-v1";
export const roomFurnitureLibraryUrl =
  "/models/room-furniture/v1/furniture.glb";

export const roomFurnitureCatalog: Record<
  RoomFurnitureVariant,
  { category: string; description: string }
> = {
  wardrobe: {
    category: "storage",
    description: "Tall closed cabinet with hinged doors",
  },
  "sliding-wardrobe": {
    category: "storage",
    description: "Tall wardrobe with overlapping sliding doors and tracks",
  },
  bookcase: {
    category: "storage",
    description: "Tall wooden bookcase with open shelves and a back panel",
  },
  "cube-shelf": {
    category: "storage",
    description: "Square grid of open cubbies",
  },
  shelving: {
    category: "storage",
    description: "Open metal rack with four posts and thin shelves",
  },
  "wall-shelf": {
    category: "storage",
    description: "Floating wall-mounted shelves without side panels",
  },
  sideboard: {
    category: "storage",
    description: "Wide low cabinet with three doors on legs",
  },
  drawers: {
    category: "storage",
    description: "Chest with four stacked drawer fronts",
  },
  "kitchen-cabinet": {
    category: "storage",
    description: "Kitchen base cabinet with worktop and two doors",
  },
  table: {
    category: "table",
    description: "Rectangular dining table on four wooden legs",
  },
  "round-table": {
    category: "table",
    description: "Circular tabletop on a central pedestal",
  },
  desk: {
    category: "table",
    description: "Office desk with metal legs and a drawer",
  },
  "coffee-table": {
    category: "table",
    description: "Low rectangular coffee table",
  },
  chair: {
    category: "chair",
    description: "Wooden dining chair with slatted back",
  },
  "office-chair": {
    category: "chair",
    description: "Upholstered swivel chair with armrests and five casters",
  },
  stool: { category: "chair", description: "Small backless seat on four legs" },
  bench: { category: "chair", description: "Wide backless bench" },
  sofa: {
    category: "sofa",
    description: "Straight upholstered sofa with separate cushions",
  },
  "corner-sofa": {
    category: "sofa",
    description: "L-shaped sofa with left-hand chaise, viewed from the front",
  },
  armchair: {
    category: "chair",
    description: "Single upholstered lounge chair with thick arms and cushion",
  },
  bed: {
    category: "bed",
    description: "Double bed with fabric headboard, duvet and two pillows",
  },
  "single-bed": {
    category: "bed",
    description: "Narrow single bed with one pillow",
  },
  "bunk-bed": {
    category: "bed",
    description: "Two stacked mattresses with safety rails and ladder",
  },
  refrigerator: {
    category: "refrigerator",
    description: "Tall fridge with separate lower freezer door",
  },
  washer: {
    category: "washer-dryer",
    description: "Front-loading washing machine with round glass door",
  },
  oven: {
    category: "oven",
    description: "Built-in oven with glass door, handle and control dials",
  },
  dishwasher: {
    category: "dishwasher",
    description: "Dishwasher with full-width front door",
  },
  toilet: {
    category: "toilet",
    description: "Floor-standing toilet with cistern and seat",
  },
  sink: {
    category: "sink",
    description: "Bathroom vanity with open ceramic basin and tap",
  },
  bathtub: {
    category: "bathtub",
    description: "Open rectangular bathtub with ceramic rim and tap",
  },
};

export function roomFurnitureCategory(category: string) {
  const value = category.trim().toLowerCase();
  const aliases: Record<string, string> = {
    cabinet: "storage",
    cupboard: "storage",
    wardrobe: "storage",
    bookcase: "storage",
    shelf: "storage",
    shelves: "storage",
    desk: "table",
    "coffee table": "table",
    armchair: "chair",
    "office chair": "chair",
    couch: "sofa",
    fridge: "refrigerator",
    washer: "washer-dryer",
    "washing machine": "washer-dryer",
    washbasin: "sink",
  };
  return aliases[value] ?? value;
}

/** ARKit measures geometry; dimensions alone cannot prove doors, shelves or upholstery. */
export function automaticRoomFurnitureVariant(
  category: string,
  dimensions: readonly number[],
): RoomFurnitureVariant | null {
  const [width = 1, height = 1] = dimensions;
  switch (roomFurnitureCategory(category)) {
    case "storage":
      return height < 1.25 && width > height * 1.25 ? "sideboard" : "wardrobe";
    case "table":
      return height < 0.55 ? "coffee-table" : "table";
    case "chair":
      return height < 0.6 ? (width > 0.85 ? "bench" : "stool") : "chair";
    case "sofa":
      return "sofa";
    case "bed":
      return width < 1.25 ? "single-bed" : "bed";
    case "refrigerator":
      return "refrigerator";
    case "washer-dryer":
      return "washer";
    case "oven":
      return "oven";
    case "dishwasher":
      return "dishwasher";
    case "toilet":
      return "toilet";
    case "sink":
      return "sink";
    case "bathtub":
      return "bathtub";
    default:
      return null;
  }
}

export function compatibleRoomFurnitureVariant(
  variant: RoomFurnitureVariant | null | undefined,
  category: string,
): RoomFurnitureVariant | null {
  return variant &&
    roomFurnitureCatalog[variant]?.category === roomFurnitureCategory(category)
    ? variant
    : null;
}

/** Balanced reference examples, bounded independently of photo count. */
export function roomFurnitureReferenceVariants(
  categories: readonly string[],
): RoomFurnitureVariant[] {
  const groups = [...new Set(categories.map(roomFurnitureCategory))].map(
    (category) =>
      roomFurnitureVariants.filter(
        (variant) => roomFurnitureCatalog[variant].category === category,
      ),
  );
  const result: RoomFurnitureVariant[] = [];
  for (
    let index = 0;
    index < roomFurnitureVariants.length && result.length < 12;
    index++
  ) {
    for (const group of groups) {
      if (group[index]) result.push(group[index]!);
      if (result.length === 12) break;
    }
  }
  return result;
}

export const roomObjectAppearanceSchema = z
  .object({
    variant: roomFurnitureVariantSchema.nullable().default(null),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .default(null),
  })
  .strict();
