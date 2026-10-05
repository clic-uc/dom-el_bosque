import { db } from '@/db/client';
import { noContent, parseParams, withActor } from '@/server/http';
import * as attachmentsService from '@/server/services/attachments';
import { uuidParamSchema } from '@/shared/schemas/common';

/** DELETE adjunto (editor/admin): borra la fila y el archivo del storage. */
export const DELETE = withActor<{ id: string }>(
  async ({ params, actor }) => {
    const id = parseParams(params.id, uuidParamSchema);
    await attachmentsService.deleteAttachment(db, actor, id);
    return noContent();
  },
  { roles: ['editor', 'admin'] },
);
