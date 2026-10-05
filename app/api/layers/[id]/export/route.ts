import { db } from '@/db/client';
import { parseParams, parseQuery, withActor } from '@/server/http';
import * as exportService from '@/server/services/export';
import { idParamSchema } from '@/shared/schemas/common';
import { exportQuerySchema } from '@/shared/schemas/records';

/** GET /api/layers/:id/export?delimiter=; → CSV en stream con BOM (§7.6). */
export const GET = withActor<{ id: string }>(async ({ req, params }) => {
  const layerId = parseParams(params.id, idParamSchema);
  const { delimiter } = parseQuery(req, exportQuerySchema);
  const { stream, fileName } = await exportService.exportCsv(db, layerId, { delimiter });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
});
