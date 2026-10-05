import { db } from '@/db/client';
import { json, noContent, parseBody, parseParams, privateNoStore, withActor } from '@/server/http';
import { discardImport, getStatus } from '@/server/import/review';
import { patchImportSource } from '@/server/import/upload';
import { uuidParamSchema } from '@/shared/schemas/common';
import { importSourcePatchSchema } from '@/shared/schemas/imports';

type P = { id: string };

/** `GET /api/imports/:id`: estado, progreso y conteos. Con `?source=1` incluye la vista previa del archivo. */
export const GET = withActor<P>(async ({ req, params }) => {
  const id = parseParams(params.id, uuidParamSchema);
  const includeSource = req.nextUrl.searchParams.get('source') === '1';
  const status = await getStatus(db, id, { includeSource });
  return json(status, { headers: privateNoStore });
});

/** `PATCH /api/imports/:id`: cambiar hoja, fila de encabezados o delimitador y volver a leer. */
export const PATCH = withActor<P>(
  async ({ req, params, actor }) => {
    const id = parseParams(params.id, uuidParamSchema);
    const patch = await parseBody(req, importSourcePatchSchema);
    const source = await patchImportSource(db, actor, id, patch);
    return json(source);
  },
  { roles: ['editor', 'admin'] },
);

/** `DELETE /api/imports/:id`: descartar el borrador. */
export const DELETE = withActor<P>(
  async ({ params, actor }) => {
    const id = parseParams(params.id, uuidParamSchema);
    await discardImport(db, actor, id);
    return noContent();
  },
  { roles: ['editor', 'admin'] },
);
