import { z } from "zod";

export const labelElementTypes = [
  "background",
  "qr",
  "image",
  "name",
  "identifier",
  "barcode",
  "url",
  "location",
] as const;

export const labelTextAlignments = ["left", "center", "right"] as const;
export const labelTextOverflowModes = ["ellipsis", "shrink"] as const;
export const labelFontFamilies = [
  "sans",
  "serif",
  "monospace",
  "rounded",
] as const;
export const labelImageFits = ["cover", "contain"] as const;

const labelColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);
const labelBackgroundSourceSchema = z
  .string()
  .max(3_000_000)
  .regex(
    /^data:image\/(?:png|jpeg|webp|gif|avif|svg\+xml);base64,[a-z0-9+/=\s]+$/i,
  );

const normalizedPositionSchema = z.number().finite().min(0).max(100);
const normalizedSizeSchema = z.number().finite().positive().max(100);

const labelElementBoxShape = {
  x: normalizedPositionSchema,
  y: normalizedPositionSchema,
  width: normalizedSizeSchema,
  height: normalizedSizeSchema,
  visible: z.boolean(),
};

const textElementOptions = {
  fontSizeMm: z.number().finite().positive().max(100).optional(),
  minFontSizeMm: z.number().finite().positive().max(100).optional(),
  fontFamily: z.enum(labelFontFamilies).optional(),
  align: z.enum(labelTextAlignments).optional(),
  textOverflow: z.enum(labelTextOverflowModes).optional(),
};

const labelElementSchemaBase = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("background"),
      ...labelElementBoxShape,
      source: labelBackgroundSourceSchema.optional(),
      fit: z.enum(labelImageFits).optional(),
      opacity: z.number().finite().min(0).max(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("qr"),
      ...labelElementBoxShape,
      foregroundColor: labelColorSchema.optional(),
      backgroundColor: labelColorSchema.optional(),
      quietZoneModules: z.number().int().min(0).max(4).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("image"),
      ...labelElementBoxShape,
      fit: z.enum(labelImageFits).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("name"),
      ...labelElementBoxShape,
      ...textElementOptions,
    })
    .strict(),
  z
    .object({
      type: z.literal("identifier"),
      ...labelElementBoxShape,
      ...textElementOptions,
    })
    .strict(),
  z.object({ type: z.literal("barcode"), ...labelElementBoxShape }).strict(),
  z
    .object({
      type: z.literal("url"),
      ...labelElementBoxShape,
      ...textElementOptions,
    })
    .strict(),
  z
    .object({
      type: z.literal("location"),
      ...labelElementBoxShape,
      ...textElementOptions,
    })
    .strict(),
]);

export const labelElementSchema = labelElementSchemaBase.superRefine(
  (element, context) => {
    if (element.x + element.width > 100) {
      context.addIssue({
        code: "custom",
        path: ["width"],
        message: "Element must fit inside the label horizontally.",
      });
    }
    if (element.y + element.height > 100) {
      context.addIssue({
        code: "custom",
        path: ["height"],
        message: "Element must fit inside the label vertically.",
      });
    }
  },
);

export const labelElementsSchema = z
  .array(labelElementSchema)
  .max(labelElementTypes.length)
  .superRefine((elements, context) => {
    const seen = new Set<string>();
    elements.forEach((element, index) => {
      if (seen.has(element.type)) {
        context.addIssue({
          code: "custom",
          path: [index, "type"],
          message: "Each label element type may only appear once.",
        });
      }
      seen.add(element.type);
    });
    if (hasVisibleQrImageOverlap(elements)) {
      const imageIndex = elements.findIndex((element) => element.type === "image");
      context.addIssue({
        code: "custom",
        path: [imageIndex < 0 ? 0 : imageIndex],
        message: "The object image must not overlap the QR code.",
      });
    }
  });

const labelSetupShape = {
  name: z.string().trim().min(1).max(160),
  widthMm: z.number().finite().positive().max(1_000),
  heightMm: z.number().finite().positive().max(1_000),
  elements: labelElementsSchema,
};

export const labelSetupCreateSchema = z.object(labelSetupShape).strict();

export const labelSetupPatchSchema = z
  .object({
    revision: z.number().int().positive(),
    name: labelSetupShape.name.optional(),
    widthMm: labelSetupShape.widthMm.optional(),
    heightMm: labelSetupShape.heightMm.optional(),
    elements: labelSetupShape.elements.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== "revision"), {
    message: "Provide at least one label setup change.",
  });

export const labelSetupDeleteSchema = z
  .object({ revision: z.coerce.number().int().positive() })
  .strict();

export type LabelElementType = (typeof labelElementTypes)[number];
export type LabelTextAlignment = (typeof labelTextAlignments)[number];
export type LabelTextOverflowMode = (typeof labelTextOverflowModes)[number];
export type LabelFontFamily = (typeof labelFontFamilies)[number];
export type LabelImageFit = (typeof labelImageFits)[number];
export type LabelElement = z.infer<typeof labelElementSchema>;
export type LabelSetupCreate = z.infer<typeof labelSetupCreateSchema>;
export type LabelSetupPatch = z.infer<typeof labelSetupPatchSchema>;

export function labelElementsOverlap(
  left: Pick<LabelElement, "x" | "y" | "width" | "height">,
  right: Pick<LabelElement, "x" | "y" | "width" | "height">,
) {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

export function hasVisibleQrImageOverlap(elements: LabelElement[]) {
  const qr = elements.find((element) => element.type === "qr" && element.visible);
  const image = elements.find(
    (element) => element.type === "image" && element.visible,
  );
  return Boolean(qr && image && labelElementsOverlap(qr, image));
}

export type LabelSetupDto = {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  elements: LabelElement[];
  revision: number;
  createdAt: string;
  updatedAt: string;
};
