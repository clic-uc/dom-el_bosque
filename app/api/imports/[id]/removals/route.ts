import { db } from '@/db/client';
import { json, parseBody, parseParams, parseQuery, privateNoStore, withActor } from '@/server/http';
import { listRemovals, patchRemovals } from '@/server/import/review';
import { paginationSchema, uuidParamSchema } from '@/shared/schemas/common';
import { importRemovalsPatchSchema } from '@/shared/schemas/imports';

type P = { id: string };

/** `GET /api/imports/:id/removals`: registros de la capa que no vienen en el archivo (reemplazo completo). */
export const GET = withActor<P>(async ({ req, params }) => {
  const id = parseParams(params.id, uuidParamSchema);
  const q = parseQuery(req, paginationSchema);
  const data = await listRemovals(db, id, q);
  return json(data, { headers: privateNoStore });
});

/** `PATCH /api/imports/:id/removals`: marcar conservar/eliminar (los no borrables se ignoran). */
export const PATCH = withActor<P>(
  async ({ req, params, actor }) => {
    const id = parseParams(params.id, uuidParamSchema);
    const input = await parseBody(req, importRemovalsPatchSchema);
    const result = await patchRemovals(db, actor, id, input);
    return json(result);
  },
  { roles: ['editor', 'admin'] },
);
