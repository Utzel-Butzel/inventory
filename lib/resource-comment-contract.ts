import { z } from "zod";

export const RESOURCE_COMMENT_MAX_LENGTH = 10_000;

export const resourceCommentBodySchema = z
  .string()
  .trim()
  .min(1, "Enter a comment.")
  .max(
    RESOURCE_COMMENT_MAX_LENGTH,
    `Comments can contain at most ${RESOURCE_COMMENT_MAX_LENGTH} characters.`,
  );

export const resourceCommentCreateSchema = z
  .object({ body: resourceCommentBodySchema })
  .strict();

export const resourceCommentUpdateSchema = resourceCommentCreateSchema;

export type ResourceCommentDto = {
  id: string;
  resourceId: string;
  body: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
};
