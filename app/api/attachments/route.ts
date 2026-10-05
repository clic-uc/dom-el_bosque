import { db } from '@/db/client';
import { ValidationError } from '@/server/errors';
import { created, json, parseBody, parseParams, parseQuery, privateNoStore, withActor } from '@/server/http';
import { rateLimit, rateLimits } from '@/server/rate-limit';
import * as attachmentsService from '@/server/services/attachments';
import {
  attachmentsQuerySchema,
  createFileAttachmentFieldsSchema,
  createLinkAttachmentSchema,
} from '@/shared/schemas/attachments';

/** GET ?entityType=&entityId= → adjuntos de un registro o polígono. */
export const GET = withActor(async ({ req }) => {
  const q = parseQuery(req, attachmentsQuerySchema);
  const rows = await attachmentsService.listAttachments(db, q.entityType, q.entityId);
  return json(rows, { headers: privateNoStore });
});

/**
 * POST (editor/admin): JSON → enlace; multipart (title, entityType, entityId, file) → archivo.
 * El tamaño y tipo del archivo se validan en el servicio (§5.5).
 */
export const POST = withActor(
  async ({ req, actor }) => {
    rateLimit(`attachment:${actor.userId}`, rateLimits.attachmentUpload);
    const contentType = req.headers.get('content-type') ?? '';

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const fields = parseParams(
        {
          title: form.get('title'),
          entityType: form.get('entityType'),
          entityId: form.get('entityId'),
        },
        createFileAttachmentFieldsSchema,
      );
      const file = form.get('file');
      if (!(file instanceof File)) {
        throw new ValidationError('Adjunta un archivo para subir');
      }
      const row = await attachmentsService.addFile(db, actor, fields, file);
      return created(row);
    }

    const input = await parseBody(req, createLinkAttachmentSchema);
    const row = await attachmentsService.addLink(db, actor, input);
    return created(row);
  },
  { roles: ['editor', 'admin'] },
);
