import { boolean, integer, jsonb, pgTable, serial, varchar } from 'drizzle-orm/pg-core';
import type { LayerField } from '@/shared/schemas/layers';
import { DEFAULT_LAYER_ICON, DEFAULT_LAYER_ICON_COLOR } from '@/shared/constants';
import { timestamps } from './common';
import { departmentEnum } from './enums';

/** Capas temáticas (§5.2). En el legacy se llamaban `maps`. */
export const layers = pgTable('layers', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 80 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  department: departmentEnum('department').notNull(),
  hasRole: boolean('has_role').notNull().default(false),
  fields: jsonb('fields').$type<LayerField[]>().notNull().default([]),
  uniqueKeys: jsonb('unique_keys').$type<string[]>().notNull().default([]),
  addressFieldKey: varchar('address_field_key', { length: 80 }),
  heatmapFieldKey: varchar('heatmap_field_key', { length: 80 }),
  icon: varchar('icon', { length: 50 }).notNull().default(DEFAULT_LAYER_ICON),
  iconColor: varchar('icon_color', { length: 20 }).notNull().default(DEFAULT_LAYER_ICON_COLOR),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});
