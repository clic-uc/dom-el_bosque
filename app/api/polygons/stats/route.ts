import { db } from '@/db/client';
import { json, parseQuery, privateNoStore, withActor } from '@/server/http';
import * as polygonsService from '@/server/services/polygons';
import { polygonStatsQuerySchema } from '@/shared/schemas/polygons';

/** GET ?kind=&layerId= → PolygonStat[] ordenado por cantidad descendente. */
export const GET = withActor(async ({ req }) => {
  const q = parseQuery(req, polygonStatsQuerySchema);
  const stats = await polygonsService.getPolygonStats(db, q);
  return json(stats, { headers: privateNoStore });
});
