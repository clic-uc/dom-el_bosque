import { db } from '@/db/client';
import { getGeocoder } from '@/server/geocoding';
import { json, parseQuery, privateNoStore, withActor } from '@/server/http';
import { rateLimit, rateLimits } from '@/server/rate-limit';
import { geocodeQuerySchema } from '@/shared/schemas/geocode';

/** GET /api/geocode?q= → GeocodeResult | null. 30/min por usuario; cadena completa con caché (§8.7). */
export const GET = withActor(async ({ req, actor }) => {
  rateLimit(
    `geocode:${actor.userId}`,
    rateLimits.geocode,
    'Demasiadas búsquedas de dirección seguidas. Espera un minuto e intenta de nuevo',
  );
  const { q } = parseQuery(req, geocodeQuerySchema);
  const result = await getGeocoder(db).geocode(q);
  return json(result ?? null, { headers: privateNoStore });
});
