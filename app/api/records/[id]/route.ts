import { db } from '@/db/client';
import { json, noContent, parseBody, parseParams, privateNoStore, withActor } from '@/server/http';
import * as recordsService from '@/server/services/records';
import { idParamSchema } from '@/shared/schemas/common';
import { deleteRecordSchema, updateRecordSchema } from '@/shared/schemas/records';

/** GET /api/records/:id → RecordDetail (con role, layer, attachments). */
export const GET = withActor<{ id: string }>(async ({ params }) => {
  const id = parseParams(params.id, idParamSchema);
  const record = await recordsService.getRecord(db, id);
  return json(record, { headers: privateNoStore });
});

/** PATCH /api/records/:id (editor/admin) → RecordDetail. */
export const PATCH = withActor<{ id: string }>(
  async ({ req, params, actor }) => {
    const id = parseParams(params.id, idParamSchema);
    const patch = await parseBody(req, updateRecordSchema);
    const record = await recordsService.updateRecord(db, actor, id, patch);
    return json(record);
  },
  { roles: ['editor', 'admin'] },
);

/** DELETE /api/records/:id (editor; admin si tiene correlativo) → 204. Body opcional `{ reason }`. */
export const DELETE = withActor<{ id: string }>(
  async ({ req, params, actor }) => {
    const id = parseParams(params.id, idParamSchema);
    const { reason } = await parseBody(req, deleteRecordSchema);
    await recordsService.deleteRecord(db, actor, id, reason || undefined);
    return noContent();
  },
  { roles: ['editor', 'admin'] },
);
