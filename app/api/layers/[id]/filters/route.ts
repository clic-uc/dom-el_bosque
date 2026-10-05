import { db } from '@/db/client';
import { json, parseParams, privateNoStore, withActor } from '@/server/http';
import * as filtersService from '@/server/services/filters';
import { idParamSchema } from '@/shared/schemas/common';

/** GET /api/layers/:id/filters → { [fieldKey]: string[] | 'text' } (§7.5). */
export const GET = withActor<{ id: string }>(async ({ params }) => {
  const layerId = parseParams(params.id, idParamSchema);
  const data = await filtersService.getFilterOptions(db, layerId);
  return json(data, { headers: privateNoStore });
});
