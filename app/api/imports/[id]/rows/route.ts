import { db } from '@/db/client';
import { json, parseParams, parseQuery, privateNoStore, withActor } from '@/server/http';
import { listRows } from '@/server/import/review';
import { uuidParamSchema } from '@/shared/schemas/common';
import { importRowsQuerySchema } from '@/shared/schemas/imports';

/** `GET /api/imports/:id/rows?status=&code=&page=&pageSize=` */
export const GET = withActor<{ id: string }>(async ({ req, params }) => {
  const id = parseParams(params.id, uuidParamSchema);
  const q = parseQuery(req, importRowsQuerySchema);
  const data = await listRows(db, id, q);
  return json(data, { headers: privateNoStore });
});
