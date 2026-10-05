import { db } from '@/db/client';
import { json, parseParams, parseQuery, privateNoStore, withActor } from '@/server/http';
import * as recordsService from '@/server/services/records';
import { idParamSchema } from '@/shared/schemas/common';
import { recordsQuerySchema } from '@/shared/schemas/records';

/** GET /api/layers/:id/records → Paginated<RecordListItem> (siempre paginado, §3.2 punto 9). */
export const GET = withActor<{ id: string }>(async ({ req, params }) => {
  const layerId = parseParams(params.id, idParamSchema);
  const query = parseQuery(req, recordsQuerySchema);
  const data = await recordsService.listRecords(db, layerId, query);
  return json(data, { headers: privateNoStore });
});
