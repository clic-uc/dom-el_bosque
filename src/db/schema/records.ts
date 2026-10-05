import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import type { RecordGeocodeInfo } from '@/shared/schemas/geocode';
import { timestamps, updatedAt } from './common';
import { pointGeometry } from './custom-types';
import { coordsSourceEnum } from './enums';
import { layers } from './layers';
import { roles } from './roles';

/** Registros (§5.4). Cada registro pertenece a exactamente una capa. */
export const records = pgTable(
  'records',
  {
    id: serial('id').primaryKey(),
    layerId: integer('layer_id')
      .notNull()
      .references(() => layers.id, { onDelete: 'cascade' }),
    roleId: varchar('role_id', { length: 11 }).references(() => roles.id, { onDelete: 'set null' }),
    lat: doublePrecision('lat'), // coordenadas que dibuja el mapa (§8.3)
    lon: doublePrecision('lon'),
    geom: pointGeometry('geom').generatedAlwaysAs(
      sql`CASE WHEN lon IS NOT NULL THEN ST_SetSRID(ST_MakePoint(lon, lat), 4326) END`,
    ),
    coordsSource: coordsSourceEnum('coords_source'),
    geocode: jsonb('geocode').$type<RecordGeocodeInfo>(),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    comments: text('comments'),
    numberAssignedAt: timestamp('number_assigned_at', { withTimezone: true }),
    numberAssignedBy: varchar('number_assigned_by', { length: 64 }),
    createdBy: varchar('created_by', { length: 64 }),
    updatedBy: varchar('updated_by', { length: 64 }),
    ...timestamps,
  },
  (t) => [
    index('records_layer_idx').on(t.layerId),
    index('records_role_idx').on(t.roleId),
    index('records_layer_role_idx').on(t.layerId, t.roleId),
    index('records_geom_gist').using('gist', t.geom),
    index('records_attributes_gin').using('gin', t.attributes),
    index('records_layer_updated_idx').on(t.layerId, t.updatedAt),
    check('records_coords_pair', sql`(lat IS NULL) = (lon IS NULL) AND (lat IS NULL) = (coords_source IS NULL)`),
    check('records_coords_role', sql`coords_source <> 'role' OR role_id IS NOT NULL`),
  ],
);

/** Contadores de correlativos (§5.4 / §8.8). */
export const layerCounters = pgTable(
  'layer_counters',
  {
    layerId: integer('layer_id')
      .notNull()
      .references(() => layers.id, { onDelete: 'cascade' }),
    fieldKey: varchar('field_key', { length: 80 }).notNull(),
    period: varchar('period', { length: 4 }).notNull().default(''), // '' si no reinicia; el año si reinicia cada año
    lastValue: integer('last_value').notNull().default(0), // último número entregado; nunca baja
    updatedAt,
  },
  (t) => [primaryKey({ columns: [t.layerId, t.fieldKey, t.period] })],
);
