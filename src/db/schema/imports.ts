import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { ImportMessage, ParsedRow } from '@/shared/schemas/import-rows';
import { createdAt } from './common';
import {
  duplicateStrategyEnum,
  importRowActionEnum,
  importRowResolutionEnum,
  importRowStatusEnum,
  importStatusEnum,
} from './enums';
import { layers } from './layers';
import { records } from './records';

export type ImportProgress = { phase?: string; done?: number; total?: number; pendingGeocode?: number };

/** Importaciones en dos fases (§5.6 / §8.5). */
export const imports = pgTable(
  'imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    layerId: integer('layer_id')
      .notNull()
      .references(() => layers.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 64 }).notNull(),
    userEmail: varchar('user_email', { length: 255 }),
    fileName: varchar('file_name', { length: 500 }).notNull(),
    fileType: varchar('file_type', { length: 4 }).notNull(), // 'csv' | 'xlsx'
    fileKey: text('file_key'), // archivo en storage; se borra al completar, descartar o vencer
    sheetName: varchar('sheet_name', { length: 120 }), // solo xlsx
    headerRow: integer('header_row').notNull().default(1),
    delimiter: varchar('delimiter', { length: 1 }), // solo csv
    columnMapping: jsonb('column_mapping').$type<Record<string, string | null>>().notNull().default({}),
    rowFrom: integer('row_from'),
    rowTo: integer('row_to'),
    duplicateStrategy: duplicateStrategyEnum('duplicate_strategy').notNull().default('ask'),
    keepExistingOnEmpty: boolean('keep_existing_on_empty').notNull().default(true),
    fullReplace: boolean('full_replace').notNull().default(false),
    geocode: boolean('geocode').notNull().default(true),
    status: importStatusEnum('status').notNull().default('UPLOADED'),
    progress: jsonb('progress').$type<ImportProgress>().notNull().default({}),
    totalRows: integer('total_rows').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    deletedCount: integer('deleted_count').notNull().default(0),
    errorMessage: text('error_message'),
    createdAt,
    analyzedAt: timestamp('analyzed_at', { withTimezone: true }),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    revertedAt: timestamp('reverted_at', { withTimezone: true }),
    revertedBy: varchar('reverted_by', { length: 64 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    index('imports_layer_created_idx').on(t.layerId, t.createdAt),
    index('imports_user_created_idx').on(t.userId, t.createdAt),
    index('imports_status_idx').on(t.status),
  ],
);

export const importRows = pgTable(
  'import_rows',
  {
    importId: uuid('import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(), // número de fila tal como se ve en la planilla
    raw: jsonb('raw').$type<Record<string, string>>().notNull(),
    parsed: jsonb('parsed').$type<ParsedRow>(),
    status: importRowStatusEnum('status').notNull(),
    messages: jsonb('messages').$type<ImportMessage[]>().notNull().default([]),
    duplicateOf: jsonb('duplicate_of').$type<number[]>().notNull().default([]),
    fileDuplicateOf: integer('file_duplicate_of'),
    resolution: importRowResolutionEnum('resolution'),
    /** Registro existente elegido para `resolution = 'update'` cuando hay varios candidatos. */
    updateTargetId: integer('update_target_id'),
    recordId: integer('record_id').references(() => records.id, { onDelete: 'set null' }),
    action: importRowActionEnum('action'),
    previousSnapshot: jsonb('previous_snapshot'),
  },
  (t) => [
    primaryKey({ columns: [t.importId, t.rowNumber] }),
    index('import_rows_import_status_idx').on(t.importId, t.status),
  ],
);

/** Solo con fullReplace: registros de la capa cuya identidad no aparece en el archivo (§8.5). */
export const importRemovals = pgTable(
  'import_removals',
  {
    importId: uuid('import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    recordId: integer('record_id').notNull(), // sin FK: el registro puede borrarse al confirmar
    deletable: boolean('deletable').notNull(),
    reason: varchar('reason', { length: 200 }),
    resolution: varchar('resolution', { length: 6 }).notNull().default('keep'), // 'keep' | 'delete'
    deleted: boolean('deleted').notNull().default(false),
    snapshot: jsonb('snapshot'),
  },
  (t) => [primaryKey({ columns: [t.importId, t.recordId] })],
);
