import { jsonb, pgTable, primaryKey, text, varchar } from 'drizzle-orm/pg-core';
import type { GeocodeResult } from '@/shared/schemas/geocode';
import { createdAt } from './common';

/** Caché de geocodificación externa (§5.3 / §8.7). También se cachea "sin resultado" (`null`). */
export const geocodeCache = pgTable(
  'geocode_cache',
  {
    provider: varchar('provider', { length: 20 }).notNull(), // 'nominatim' | 'photon'
    query: text('query').notNull(), // dirección normalizada
    result: jsonb('result').$type<GeocodeResult | null>(),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.provider, t.query] })],
);
