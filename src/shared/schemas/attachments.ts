import { z } from 'zod';

export const attachmentEntityTypes = ['record', 'polygon'] as const;
export type AttachmentEntityType = (typeof attachmentEntityTypes)[number];

export const attachmentsQuerySchema = z.object({
  entityType: z.enum(attachmentEntityTypes),
  entityId: z.string().min(1).max(64),
});
export type AttachmentsQuery = z.infer<typeof attachmentsQuerySchema>;

const httpUrl = z
  .string()
  .trim()
  .url('Escribe una dirección web válida (debe empezar con http:// o https://)')
  .refine((u) => /^https?:\/\//i.test(u), 'El enlace debe empezar con http:// o https://');

export const createLinkAttachmentSchema = z.object({
  entityType: z.enum(attachmentEntityTypes),
  entityId: z.string().min(1).max(64),
  title: z.string().trim().min(1, 'Escribe un título').max(200),
  url: httpUrl,
});
export type CreateLinkAttachmentInput = z.infer<typeof createLinkAttachmentSchema>;

export const createFileAttachmentFieldsSchema = z.object({
  entityType: z.enum(attachmentEntityTypes),
  entityId: z.string().min(1).max(64),
  title: z.string().trim().min(1, 'Escribe un título').max(200),
});
