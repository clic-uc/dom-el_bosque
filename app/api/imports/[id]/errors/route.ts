import { db } from '@/db/client';
import { parseParams, withActor } from '@/server/http';
import { buildErrorsCsv } from '@/server/import/errors-csv';
import { uuidParamSchema } from '@/shared/schemas/common';

/** `GET /api/imports/:id/errors`: CSV con las filas fallidas (encabezados originales + columna Error). */
export const GET = withActor<{ id: string }>(async ({ params }) => {
  const id = parseParams(params.id, uuidParamSchema);
  const { csv, fileName } = await buildErrorsCsv(db, id);
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, no-store',
    },
  });
});
