import { db } from '@/db/client';
import { json, parseParams, parseQuery, privateNoStore, withActor } from '@/server/http';
import * as recordsService from '@/server/services/records';
import { idParamSchema } from '@/shared/schemas/common';
import { featuresQuerySchema } from '@/shared/schemas/records';

/** GET /api/layers/:id/features → FeatureCollection de los registros con coordenadas (§7.3). */
export const GET = withActor<{ id: string }>(async ({ req, params }) => {
  const layerId = parseParams(params.id, idParamSchema);
  const query = parseQuery(req, featuresQuerySchema);
  const data = await recordsService.getFeatures(db, layerId, query);
  return json(data, { headers: privateNoStore });
});
