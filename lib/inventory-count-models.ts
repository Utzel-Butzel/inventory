export const inventoryCountModelIds = [
  "grounding-dino",
  "yolo-world",
  "sam-2",
  "sam-3",
] as const;

export type InventoryCountModelId = (typeof inventoryCountModelIds)[number];

export type InventoryCountModel = {
  id: InventoryCountModelId;
  provider: "replicate";
  model: string;
  label: string;
  description: string;
};

export type InventoryCountModelCatalog = {
  models: InventoryCountModel[];
  defaultModelId: InventoryCountModelId;
};

const models: InventoryCountModel[] = [
  {
    id: "grounding-dino",
    provider: "replicate",
    model: "adirik/grounding-dino",
    label: "Grounding DINO · fast",
    description: "Fast object detection with text-guided bounding boxes.",
  },
  {
    id: "yolo-world",
    provider: "replicate",
    model: "ultralytics/yolov8s-worldv2",
    label: "YOLO World · fast",
    description: "Fast open-vocabulary YOLO detection for a named object class.",
  },
  {
    id: "sam-2",
    provider: "replicate",
    model: "meta/sam-2",
    label: "SAM 2 · experimental",
    description: "Segments all visible regions without understanding the item text.",
  },
  {
    id: "sam-3",
    provider: "replicate",
    model: "yodagg/sam3-image-seg",
    label: "SAM 3 · precise masks",
    description: "More detailed segmentation, but a cold start can take longer.",
  },
];

export const isInventoryCountModelId = (
  value: unknown,
): value is InventoryCountModelId =>
  typeof value === "string" &&
  (inventoryCountModelIds as readonly string[]).includes(value);

export const getInventoryCountModelCatalog = (): InventoryCountModelCatalog => {
  const configuredDefault = process.env.REPLICATE_COUNT_DEFAULT_MODEL?.trim();
  return {
    models: models.map((model) => ({ ...model })),
    defaultModelId: isInventoryCountModelId(configuredDefault)
      ? configuredDefault
      : "grounding-dino",
  };
};

export const resolveInventoryCountModel = (
  requestedModelId?: string,
): InventoryCountModel | null => {
  const modelId = requestedModelId ?? getInventoryCountModelCatalog().defaultModelId;
  return models.find((model) => model.id === modelId) ?? null;
};
