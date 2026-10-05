import { index, jsonb, pgTable, serial, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { timestamps } from './common';
import { multiPolygonGeometry } from './custom-types';
import { polygonKindEnum } from './enums';

/** Polígonos de referencia (§5.5): comuna, sectores, villas/poblaciones. */
export const polygons = pgTable(
  'polygons',
  {
    id: serial('id').primaryKey(),
    kind: polygonKindEnum('kind').notNull(),
    code: varchar('code', { length: 50 }), // id de origen del GeoJSON, para re-importar de forma idempotente
    name: varchar('name', { length: 200 }),
    properties: jsonb('properties').$type<Record<string, unknown>>().notNull().default({}),
    geom: multiPolygonGeometry('geom').notNull(),
    ...timestamps,
  },
  (t) => [index('polygons_geom_gist').using('gist', t.geom), uniqueIndex('polygons_kind_code_uq').on(t.kind, t.code)],
);
