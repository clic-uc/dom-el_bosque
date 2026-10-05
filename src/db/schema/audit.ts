import { index, integer, jsonb, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt } from './common';
import { auditActionEnum, auditEntityEnum } from './enums';

/** Auditoría (§5.7). Una importación confirmada genera un solo log IMPORT. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: varchar('user_id', { length: 64 }).notNull(),
    userEmail: varchar('user_email', { length: 255 }), // snapshot: se conserva aunque el usuario se elimine
    action: auditActionEnum('action').notNull(),
    entityType: auditEntityEnum('entity_type').notNull(),
    entityId: varchar('entity_id', { length: 64 }).notNull(),
    layerId: integer('layer_id'), // denormalizado para filtrar
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt,
  },
  (t) => [
    index('audit_logs_user_created_idx').on(t.userId, t.createdAt),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_created_idx').on(t.createdAt),
  ],
);
