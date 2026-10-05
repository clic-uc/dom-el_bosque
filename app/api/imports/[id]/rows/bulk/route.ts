import { db } from '@/db/client';
import { json, parseBody, parseParams, withActor } from '@/server/http';
import { bulkRows } from '@/server/import/review';
import { uuidParamSchema } from '@/shared/schemas/common';
import { importRowsBulkSchema } from '@/shared/schemas/imports';

/** `POST /api/imports/:id/rows/bulk`: acción en bloque sobre las filas que calzan con el filtro. */
export const POST = withActor<{ id: string }>(
  async ({ req, params, actor }) => {
    const id = parseParams(params.id, uuidParamSchema);
    const input = await parseBody(req, importRowsBulkSchema);
    const result = await bulkRows(db, actor, id, input);
    return json(result);
  },
  { roles: ['editor', 'admin'] },
);
