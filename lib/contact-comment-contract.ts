export {
  RESOURCE_COMMENT_MAX_LENGTH as CONTACT_COMMENT_MAX_LENGTH,
  resourceCommentBodySchema as contactCommentBodySchema,
  resourceCommentCreateSchema as contactCommentCreateSchema,
  resourceCommentUpdateSchema as contactCommentUpdateSchema,
} from "@/lib/resource-comment-contract";

export type ContactCommentDto = {
  id: string;
  contactId: string;
  body: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
};
