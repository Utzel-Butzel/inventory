import { z } from "zod";

export const labelElementTypes = [
  "background",
  "qr",
  "image",
  "name",
  "subtitle",
  "identifier",
  "barcode",
  "url",
  "location",
  "text",
] as const;

export const MAX_LABEL_ELEMENTS = 32;
export const MAX_LABEL_TEXT_LENGTH = 8_000;

export const labelTextRunSchema = z.object({
  text: z.string().max(MAX_LABEL_TEXT_LENGTH),
  weight: z.number().int().min(100).max(900).multipleOf(100).optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
}).strict();

export const labelTextContentSchema = z.array(labelTextRunSchema).max(500).refine(
  (runs) => runs.reduce((length, run) => length + run.text.length, 0) <= MAX_LABEL_TEXT_LENGTH,
  { message: "Text must not exceed 8000 characters." },
);

export type LabelTextRun = z.infer<typeof labelTextRunSchema>;

export const labelTextAlignments = ["left", "center", "right"] as const;
export const labelTextVerticalAlignments = ["top", "middle", "bottom"] as const;
export const labelTextOverflowModes = ["ellipsis", "shrink"] as const;
export const labelFontFamilies = [
  "sans",
  "serif",
  "monospace",
  "rounded",
  "barlow-semi-condensed",
  "inter",
  "roboto",
  "roboto-condensed",
  "nunito-sans",
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
  // Older templates identify their single instance by type.
  id: z.string().uuid().optional(),
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
  fontWeight: z.number().int().min(100).max(900).multipleOf(100).optional(),
  letterSpacingEm: z.number().finite().min(-0.1).max(1).optional(),
  lineHeight: z.number().finite().min(0.8).max(3).optional(),
  align: z.enum(labelTextAlignments).optional(),
  verticalAlign: z.enum(labelTextVerticalAlignments).optional(),
  textOverflow: z.enum(labelTextOverflowModes).optional(),
  content: labelTextContentSchema.optional(),
};

const labelElementSchemaBase = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    ...labelElementBoxShape,
    id: z.string().uuid(),
    ...textElementOptions,
    content: labelTextContentSchema,
  }).strict(),
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
      source: labelBackgroundSourceSchema.optional(),
      altText: z.string().max(300).optional(),
      fit: z.enum(labelImageFits).optional(),
      photoOptimization: z.enum(["auto", "standard"]).optional(),
      cropWhiteMargins: z.boolean().optional(),
      cropTolerance: z.number().finite().min(0).max(80).optional(),
      cropPadding: z.number().finite().min(-10).max(20).optional(),
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
      type: z.literal("subtitle"),
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
  .max(MAX_LABEL_ELEMENTS)
  .superRefine((elements, context) => {
    const seen = new Set<string>();
    elements.forEach((element, index) => {
      const key = labelElementKey(element);
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: [index, element.id ? "id" : "type"],
          message: "Each label element must have a unique identity.",
        });
      }
      seen.add(key);
    });
    const imageIndex = overlappingImageIndex(elements);
    if (imageIndex >= 0) {
      context.addIssue({
        code: "custom",
        path: [imageIndex],
        message: "The object image must not overlap the QR code.",
      });
    }
  });

const labelSetupShape = {
  name: z.string().trim().min(1).max(160),
  widthMm: z.number().finite().positive().max(1_000),
  heightMm: z.number().finite().positive().max(1_000),
  elements: labelElementsSchema,
  inverted: z.boolean().optional(),
};

export const labelSetupCreateSchema = z.object(labelSetupShape).strict();

export const labelSetupPatchSchema = z
  .object({
    revision: z.number().int().positive(),
    name: labelSetupShape.name.optional(),
    widthMm: labelSetupShape.widthMm.optional(),
    heightMm: labelSetupShape.heightMm.optional(),
    elements: labelSetupShape.elements.optional(),
    inverted: labelSetupShape.inverted,
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
export type LabelTextVerticalAlignment = (typeof labelTextVerticalAlignments)[number];
export type LabelTextOverflowMode = (typeof labelTextOverflowModes)[number];
export type LabelFontFamily = (typeof labelFontFamilies)[number];
export type LabelImageFit = (typeof labelImageFits)[number];
export type LabelElement = z.infer<typeof labelElementSchema>;
export type LabelTextElement = Extract<LabelElement, {
  type: "name" | "subtitle" | "identifier" | "url" | "location" | "text";
}>;
export type LabelSetupCreate = z.infer<typeof labelSetupCreateSchema>;
export type LabelSetupPatch = z.infer<typeof labelSetupPatchSchema>;

export function labelElementKey(element: LabelElement): string {
  return element.id ?? element.type;
}

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

function overlappingImageIndex(elements: LabelElement[]) {
  const qrCodes = elements.filter((element) => element.type === "qr" && element.visible);
  return elements.findIndex(
    (element) => element.type === "image" && element.visible &&
      qrCodes.some(qr => labelElementsOverlap(qr, element)),
  );
}

export function hasVisibleQrImageOverlap(elements: LabelElement[]) {
  return overlappingImageIndex(elements) >= 0;
}

export type LabelSetupDto = {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  elements: LabelElement[];
  inverted?: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
