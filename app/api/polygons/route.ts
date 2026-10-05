import { db } from '@/db/client';
import { json, parseQuery, withActor } from '@/server/http';
import * as polygonsService from '@/server/services/polygons';
import { polygonsQuerySchema } from '@/shared/schemas/polygons';

const cacheControl = 'private, max-age=0, must-revalidate';

/** GET ?kind= → FeatureCollection con ETag; responde 304 si If-None-Match coincide (§7.9). */
export const GET = withActor(async ({ req }) => {
  const { kind } = parseQuery(req, polygonsQuerySchema);
  const { collection, etag } = await polygonsService.listPolygons(db, kind);

  const ifNoneMatch = req.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch.split(',').some((t) => t.trim() === etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': cacheControl } });
  }

  return json(collection, { headers: { ETag: etag, 'Cache-Control': cacheControl } });
});
