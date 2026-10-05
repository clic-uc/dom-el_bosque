import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt } from './common';
import { attachmentEntityEnum, attachmentKindEnum } from './enums';

/** Adjuntos de registros y polígonos (§5.5): enlaces o archivos en storage. */
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: attachmentEntityEnum('entity_type').notNull(),
    entityId: varchar('entity_id', { length: 64 }).notNull(), // records.id o polygons.id como texto
    kind: attachmentKindEnum('kind').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    url: text('url'), // kind = 'link'
    storageKey: text('storage_key'), // kind = 'file'
    fileName: varchar('file_name', { length: 255 }),
    mimeType: varchar('mime_type', { length: 120 }),
    sizeBytes: integer('size_bytes'),
    createdBy: varchar('created_by', { length: 64 }),
    createdAt,
  },
  (t) => [
    index('attachments_entity_idx').on(t.entityType, t.entityId),
    check(
      'attachments_kind_fields',
      sql`(kind = 'link' AND url IS NOT NULL) OR (kind = 'file' AND storage_key IS NOT NULL)`,
    ),
  ],
);
